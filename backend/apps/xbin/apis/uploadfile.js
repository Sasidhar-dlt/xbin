/**
 * Handles upload requests. 
 * (C) 2020 TekMonks. All rights reserved.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const util = require("util");
const fspromises = fs.promises;
const stream = require("stream");
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const cms = require(`${API_CONSTANTS.LIB_DIR}/cms.js`);
const CONF = require(`${API_CONSTANTS.CONF_DIR}/xbin.json`);
const quotas = require(`${API_CONSTANTS.LIB_DIR}/quotas.js`);

exports.doService = async (jsonReq, _servObject, headers, _url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}
	
	LOG.debug("Got uploadfile request for path: " + jsonReq.path);

	const fullpath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.path}`), temppath = path.resolve(`${fullpath}${API_CONSTANTS.XBIN_TEMP_FILE_SUFFIX}`);
	if (!await cms.isSecure(headers, fullpath)) {LOG.error(`Path security validation failure: ${jsonReq.path}`); return CONSTANTS.FALSE_RESULT;}

	try {
        const matches = jsonReq.data.match(/^data:.*;base64,(.*)$/); 
        if (!matches) throw `Bad data encoding: ${jsonReq.data}`;
		const bufferToWrite = Buffer.from(matches[1], "base64");
		if (!(await quotas.checkQuota(headers, bufferToWrite.length)).result) throw (`Quota is full write failed for path ${fullpath}.`);
		// convert this to a piped encrypted stream if the disk is secured
        if (CONF.DISK_SECURED) await _appendOrWriteEncrypted(temppath, bufferToWrite, jsonReq.startOfFile?false:true);
		else await fspromises[jsonReq.startOfFile?"writeFile":"appendFile"](temppath, bufferToWrite);
		if (jsonReq.endOfFile) await fspromises.rename(temppath, fullpath);

		exports.updateFileStats(fullpath, jsonReq.path, bufferToWrite.length, jsonReq.endOfFile, API_CONSTANTS.XBIN_FILE);

		LOG.debug(`Added ${bufferToWrite.length} bytes to the file at eventual path ${fullpath} using temp path ${temppath}.`);
        
		return CONSTANTS.TRUE_RESULT;
	} catch (err) {
		LOG.error(`Error writing to path: ${fullpath}, error is: ${err}`); 
		try {await fspromises.unlink(fullpath)} catch(err) {};
		return CONSTANTS.FALSE_RESULT;
	}
}

exports.writeUTF8File = async function (headers, inpath, data) {
	const fullpath = path.resolve(`${await cms.getCMSRoot(headers)}/${inpath}`);
	if (!await cms.isSecure(headers, fullpath)) throw `Path security validation failure: ${fullpath}`;

	let additionalBytesToWrite = data.length; 
	try {additionalBytesToWrite = data.length - (await exports.getFileStats(fullpath)).size;} catch (err) {};	// file may not exist at all
	if (!(await quotas.checkQuota(headers, additionalBytesToWrite)).result) throw `Quota is full write failed for ${fullpath}`;

	const zippable = exports.isZippable(fullpath);
	if (CONF.DISK_SECURED) await _appendOrWriteEncrypted(fullpath, data);
	else await fspromises.writeFile(fullpath, zippable ? await util.promisify(zlib.gzip)(data) : data, "utf8");

	exports.updateFileStats(fullpath, inpath, data.length, true, API_CONSTANTS.XBIN_FILE);
}

exports.updateFileStats = async function (fullpathOrRequestHeaders, remotepath, dataLengthWritten, transferFinished, type, commentin) {
	const fullpath = typeof fullpathOrRequestHeaders !== 'string' ? (await _getSecureFullPath(fullpathOrRequestHeaders, remotepath)) : fullpathOrRequestHeaders;
	const metaPath = fullpath+API_CONSTANTS.STATS_EXTENSION, clusterMemory = CLUSTER_MEMORY.get(API_CONSTANTS.MEM_KEY_UPLOADFILE, {});
	if (!clusterMemory.files_stats) clusterMemory.files_stats = {};
	if (!clusterMemory.files_stats[fullpath]){
		try {
			await fspromises.access(metaPath, fs.constants.W_OK & fs.constants.R_OK);
			clusterMemory.files_stats[fullpath] = await fspromises.readFile(metaPath, "utf8"); 
		} catch (err) {
			const stats = await fspromises.stat(fullpath); 
			clusterMemory.files_stats[fullpath] = { ...stats, remotepath, size: 0, byteswritten: 0, 
				xbintype: type||(stats.isFile()?API_CONSTANTS.XBIN_FILE:(stats.isDirectory()?API_CONSTANTS.XBIN_FOLDER:"UNKNOWN")), 
				comment: commentin||"" }; 
		} 
	}
	
	if (dataLengthWritten !== undefined) {
		clusterMemory.files_stats[fullpath].byteswritten += dataLengthWritten; 
		clusterMemory.files_stats[fullpath].size = clusterMemory.files_stats[fullpath].byteswritten;
	}
	if (commentin) clusterMemory.files_stats[fullpath].comment = commentin;

	if (transferFinished) {
		await fspromises.writeFile(metaPath, JSON.stringify(clusterMemory.files_stats[fullpath]));
		if (dataLengthWritten) clusterMemory.files_stats[fullpath].byteswritten = 0; 	// we updated due to a write and have finished uploading
	}

	CLUSTER_MEMORY.set(API_CONSTANTS.MEM_KEY_UPLOADFILE, clusterMemory);
}

exports.getFileStats = async fullpath => {	// cache and return to avoid repeated reads
	const clusterMemory = CLUSTER_MEMORY.get(API_CONSTANTS.MEM_KEY_UPLOADFILE, {});
	if (!clusterMemory.files_stats) clusterMemory.files_stats = {};
	if (!clusterMemory.files_stats[fullpath]) clusterMemory.files_stats[fullpath] = await JSON.parse(await fspromises.readFile(fullpath+API_CONSTANTS.STATS_EXTENSION, "utf8"));
	return {...clusterMemory.files_stats[fullpath]};
}

exports.createFolder = async function(headers, inpath) {
	const fullpath = path.resolve(`${await cms.getCMSRoot(headers)}/${inpath}`);
	if (!await cms.isSecure(headers, fullpath)) throw (`Path security validation failure: ${inpath}`);
	try {await fspromises.mkdir(fullpath);} catch (err) {if (err.code !== "EEXIST") throw err; else LOG.warn("Told to create a folder which already exists, ignorning: "+fullpath);}	// already exists is ok
	await exports.updateFileStats(fullpath, inpath, undefined, true, API_CONSTANTS.XBIN_FOLDER);
}

exports.isZippable = fullpath => !((CONF.DONT_GZIP_EXTENSIONS||[]).includes(path.extname(fullpath)));

exports.deleteDiskFileMetadata = async function(fullpath) {
	await fspromises.unlink(fullpath+API_CONSTANTS.STATS_EXTENSION);
	const clusterMemory = CLUSTER_MEMORY.get(API_CONSTANTS.MEM_KEY_UPLOADFILE, {});
	if (clusterMemory && clusterMemory.files_stats && clusterMemory.files_stats[fullpath]) {
		delete clusterMemory.files_stats[fullpath];
		CLUSTER_MEMORY.set(API_CONSTANTS.MEM_KEY_UPLOADFILE, clusterMemory);
	}
}

exports.renameDiskFileMetadata = async function (oldpath, newpath) {
	await fspromises.rename(oldpath+API_CONSTANTS.STATS_EXTENSION, newpath+API_CONSTANTS.STATS_EXTENSION);
	const clusterMemory = CLUSTER_MEMORY.get(API_CONSTANTS.MEM_KEY_UPLOADFILE, {});
	if (clusterMemory && clusterMemory.files_stats && clusterMemory.files_stats[oldpath]) {
		clusterMemory.files_stats[newpath] == {...clusterMemory.files_stats[oldpath]};
		delete clusterMemory.files_stats[oldpath];
		CLUSTER_MEMORY.set(API_CONSTANTS.MEM_KEY_UPLOADFILE, clusterMemory);
	}
}

exports.isFileConsistentOnDisk = async fullpath => {
	try {
		await fspromises.access(fullpath, fs.constants.R_OK);
		await fspromises.access(fullpath+API_CONSTANTS.STATS_EXTENSION, fs.constants.R_OK);
		return true;
	} catch (err) {return false;}
}

async function _getSecureFullPath(headers, inpath) {
	const fullpath = path.resolve(`${await cms.getCMSRoot(headers)}/${inpath}`);
	if (!await cms.isSecure(headers, fullpath)) {LOG.error(`Path security validation failure: ${inpath}`); throw `Path security validation failure: ${inpath}`;}
	return fullpath;
}

function _appendOrWriteEncrypted(inpath, buffer, append) {
	return new Promise((resolve, reject) => {
		const fsWriteStream = fs.createWriteStream(inpath, {"flags":append?"a":"w"});
		let readableStream = stream.Readable.from(buffer);
		if (exports.isZippable(inpath)) readableStream = readableStream.pipe(zlib.createGzip());	// gzip to save disk space and download bandwidth for downloads
		readableStream.pipe(crypt.getCipher(CONF.SECURED_KEY)).pipe(fsWriteStream); 
		fsWriteStream.on("finish", _ => resolve()); fsWriteStream.on("error", error => reject(error));
	});
}

const validateRequest = jsonReq => (jsonReq && jsonReq.path && jsonReq.data && (jsonReq.startOfFile !== undefined) && (jsonReq.endOfFile  !== undefined));