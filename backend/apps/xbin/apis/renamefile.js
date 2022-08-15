/* 
 * (C) 2020 TekMonks. All rights reserved.
 */
const path = require("path");
const sqlite3 = require("sqlite3");
const fspromises = require("fs").promises;
const cms = require(`${API_CONSTANTS.LIB_DIR}/cms.js`);

let xbinDB;

function _initDB() {
	return new Promise((resolve, reject) => {
		if (!xbinDB) xbinDB = new sqlite3.Database(API_CONSTANTS.APP_DB, sqlite3.OPEN_READWRITE, err => {
			if (!err) {dbrunAsync = require("util").promisify(xbinDB.run.bind(xbinDB)); resolve();} else reject(err);
		}); else resolve();
	});
}

exports.doService = async (jsonReq, _, headers) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}
	
	LOG.debug("Got renamefile request for path: " + jsonReq.old);

	const oldPath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.old}`); const newPath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.new}`);
	if (!await cms.isSecure(headers, oldPath)) {LOG.error(`Path security validation failure: ${jsonReq.old}`); return CONSTANTS.FALSE_RESULT;}

	try {
		await fspromises.rename(oldPath, newPath);
		await _initDB(); await dbrunAsync("UPDATE shares SET fullpath = ? WHERE fullpath = ?", [newPath, oldPath]);	// update shares
        return CONSTANTS.TRUE_RESULT;
	} catch (err) {LOG.error(`Error renaming  path: ${oldPath}, error is: ${err}`); return CONSTANTS.FALSE_RESULT;}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.old && jsonReq.new);
