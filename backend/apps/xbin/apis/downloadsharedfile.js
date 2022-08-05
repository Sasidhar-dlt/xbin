/* 
 * (C) 2020 TekMonks. All rights reserved.
 */
const util = require("util");
const sqlite3 = require("sqlite3");
const downloadfile = require(`${API_CONSTANTS.API_DIR}/downloadfile.js`);

let xbinDB;

function _initDB() {
	return new Promise((resolve, reject) => {
		if (!xbinDB) xbinDB = new sqlite3.Database(API_CONSTANTS.APP_DB, sqlite3.OPEN_READWRITE, err => {
			if (!err) resolve(); else reject(err);
		}); else resolve();
	});
}

exports.handleRawRequest = async (jsonReq, servObject, headers, url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); _sendError(servObject); return;}
	
	LOG.debug("Got download shared file request for id: " + jsonReq.id);

	try {
		await _initDB(); 
		const share = await (util.promisify(xbinDB.get.bind(xbinDB))("SELECT fullpath, expiry FROM shares WHERE id = ?", [jsonReq.id]));
        
        if (!share) throw ({code: 404, message: "Not found"}); 
        if (Date.now() > share.expiry) throw ({code: 404, message: "Not found"});   // has expired
        
        return downloadfile.downloadFile({fullpath: share.fullpath, reqid:"__never_use_none"}, servObject, headers, url);
	} catch (err) {
        LOG.error(`Share ID resulted in DB error ${err}`); 
        throw ({code: 404, message: "Not found"}); 
    }
}

function _sendError(servObject, unauthorized) {
	if (!servObject.res.writableEnded) {
		if (unauthorized) servObject.server.statusUnauthorized(servObject); 
		else servObject.server.statusInternalError(servObject); 
		servObject.server.end(servObject);
	}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id);
