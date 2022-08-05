/* 
 * (C) 2020 TekMonks. All rights reserved.
 */
const getsecurid = require(`${API_CONSTANTS.API_DIR}/getsecurid.js`);
const downloadfile = require(`${API_CONSTANTS.API_DIR}/downloadfile.js`);
const jwtTokenManager = require(`${CONSTANTS.LIBDIR}/apiregistry.js`).getExtension("jwtTokenManager");

exports.handleRawRequest = async (jsonObj, servObject, headers, url, _apiconf) => {
	if (!validateRequest(jsonObj) ) {LOG.error("Validation failure."); _sendError(servObject, "Validation failure."); return;}
	if (!jwtTokenManager.checkToken(jsonObj.auth)) {LOG.error("Validation failure, wrong AUTH."); _sendError(servObject, "Validation failure."); return;}
	
	LOG.debug("Got DND downloadfile request for path: " + jsonObj.path);
	const securid = getsecurid.getSecurID(jsonObj);
    downloadfile.handleRawRequest({...jsonObj, securid}, servObject, headers, url);
}

function _sendError(servObject, err) {
	if (!servObject.res.writableEnded) {
		servObject.server.statusInternalError(servObject, err); 
		servObject.server.end(servObject);
	}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.path && jsonReq.reqid && jsonReq.auth);
