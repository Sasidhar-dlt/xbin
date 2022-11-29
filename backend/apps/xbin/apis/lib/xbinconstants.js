/** 
 * (C) 2015 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");

APP_ROOT = `${path.resolve(`${__dirname}/../../`)}`;

exports.APP_ROOT = APP_ROOT;
exports.API_DIR = `${APP_ROOT}/apis`;
exports.CONF_DIR = `${APP_ROOT}/conf`;
exports.LIB_DIR = `${APP_ROOT}/apis/lib`;
exports.XBIN_IGNORE_PATH_SUFFIX = "._____________xbin__________temp___________path_______";

exports.isSubdirectory = (child, parent) => { // from: https://stackoverflow.com/questions/37521893/determine-if-a-path-is-subdirectory-of-another-in-node-js
    child = path.resolve(child); parent = path.resolve(parent);

    if (parent.toLowerCase() == child.toLowerCase()) return true;	// a directory is its own subdirectory (remember ./)

    const relative = path.relative(parent, child);
    const isSubdir = !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    return isSubdir;
}