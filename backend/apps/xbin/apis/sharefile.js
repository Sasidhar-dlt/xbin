/* 
 * (C) 2020 TekMonks. All rights reserved.
 */
const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const cms = require(`${API_CONSTANTS.LIB_DIR}/cms.js`);
const CONF = require(`${API_CONSTANTS.CONF_DIR}/xbin.json`);

let xbinDB, dbrunAsync;

function _initDB() {
	return new Promise((resolve, reject) => {
		if (!xbinDB) xbinDB = new sqlite3.Database(API_CONSTANTS.APP_DB, sqlite3.OPEN_READWRITE, err => {
			if (!err) {dbrunAsync = require("util").promisify(xbinDB.run.bind(xbinDB)); resolve();} else reject(err);
		}); else resolve();
	});
}

exports.doService = async (jsonReq, _, headers) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}

	try {
		await _initDB(); 
		if (jsonReq.path) {	// create initial share
			LOG.debug("Got share file request for path: " + jsonReq.path);

			const fullpath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.path}`);
			if (!await cms.isSecure(headers, fullpath)) {LOG.error(`Path security validation failure: ${jsonReq.path}`); return CONSTANTS.FALSE_RESULT;}
			
			const expiry = Date.now()+((jsonReq.expiry||CONF.DEFAULT_SHARED_FILE_EXPIRY)*86400000);	
			const id = crypto.createHash("sha512").update(fullpath+expiry+(Math.random()*(1000000 - 1)+1)).digest("hex");
			await dbrunAsync("INSERT INTO shares(fullpath, id, expiry) VALUES (?,?,?)", [fullpath,id,expiry]);
			return {result: true, id};
		} else {	// update expiry
			if (jsonReq.expiry != 0) await dbrunAsync("UPDATE shares SET expiry = ? WHERE id = ?", [Date.now()+(jsonReq.expiry*86400000),jsonReq.id]);
			else await dbrunAsync("DELETE FROM shares WHERE id = ?", [jsonReq.id]);
			return {result: true, id: jsonReq.id};
		}
	} catch (err) {LOG.error(`Error sharing  path: ${fullpath}, error is: ${err}`); return CONSTANTS.FALSE_RESULT;}
}

const validateRequest = jsonReq => (jsonReq && (jsonReq.path || (jsonReq.id && jsonReq.expiry)));
