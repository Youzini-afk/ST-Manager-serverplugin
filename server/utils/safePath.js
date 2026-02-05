const path = require('path');

function normalizePath(input) {
    return path.resolve(path.normalize(input));
}

function isPathInside(rootPath, targetPath) {
    if (!rootPath || !targetPath) return false;
    const root = normalizePath(rootPath);
    const target = normalizePath(targetPath);

    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    const targetValue = process.platform === 'win32' ? target.toLowerCase() : target;
    const rootValue = process.platform === 'win32' ? root.toLowerCase() : root;
    const rootWithSepValue = process.platform === 'win32' ? rootWithSep.toLowerCase() : rootWithSep;

    return targetValue === rootValue || targetValue.startsWith(rootWithSepValue);
}

function resolveInside(rootPath, unsafePath) {
    if (!rootPath || typeof unsafePath !== 'string') return null;
    let cleaned = unsafePath.trim();
    if (!cleaned) return null;

    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
    }

    const root = normalizePath(rootPath);
    const resolved = path.isAbsolute(cleaned)
        ? normalizePath(cleaned)
        : normalizePath(path.join(root, cleaned));

    return isPathInside(root, resolved) ? resolved : null;
}

module.exports = {
    normalizePath,
    isPathInside,
    resolveInside,
};
