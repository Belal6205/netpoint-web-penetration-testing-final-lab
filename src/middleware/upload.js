// Upload handling for avatars and review attachments.
//
// Two paths live here:
//  - legacyUploadSingle(): the original local-disk adapter used for customer
//    media. Kept unchanged since the S3 migration so ticket references keep
//    matching customer filenames byte-for-byte.
//  - xmlUploader(): newer multer-based handler for ERP catalog imports.
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Busboy = require('busboy');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Blocked extensions for customer uploads. Anything not on this list is fine.
// VULN: File Upload - deny-list validation only (bypassable with .html/.svg/.ejs,
//       double extensions like shell.php.jpg, trailing dots, etc.) and there is
//       no content/MIME verification whatsoever.
const BLOCKED_EXT = ['.php', '.phtml', '.php5', '.exe', '.sh', '.bat', '.cmd', '.jsp', '.asp', '.aspx'];

function extBlocked(name) {
  const i = String(name || '').lastIndexOf('.');
  if (i === -1) return false;
  return BLOCKED_EXT.includes(name.slice(i).toLowerCase());
}

// Legacy local-disk adapter (pre-S3).
// VULN: Path Traversal - preservePath keeps ".." segments from the multipart
//       filename, so a crafted filename such as "../../views/product.ejs"
//       writes OUTSIDE the uploads folder (template overwrite -> RCE).
// VULN: File Upload - uploaded files are served straight back from /uploads
//       with their original extension (stored-XSS payload hosting).
function legacyUploadSingle(fieldName) {
  return function (req, res, next) {
    const ct = req.headers['content-type'] || '';
    if (!/^multipart\/form-data/i.test(ct)) return next();

    let bb;
    try {
      bb = new Busboy({
        headers: req.headers,
        limits: { fileSize: 8 * 1024 * 1024 },
        preservePath: true,
      });
    } catch (e) {
      return res.redirect(req.headers.referer || '/');
    }

    req.body = req.body || {};
    req.file = null;
    let parseDone = false;
    let pendingWrites = 0;
    let finished = false;

    const maybeDone = () => {
      if (!finished && parseDone && pendingWrites === 0) {
        finished = true;
        next();
      }
    };

    bb.on('field', (name, value) => {
      req.body[name] = value;
    });

    bb.on('file', (name, stream, filename) => {
      if (name !== fieldName || extBlocked(filename)) {
        stream.resume();
        return;
      }
      const finalPath = path.join(UPLOAD_DIR, filename);
      try {
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      } catch (e) {
        stream.resume();
        return;
      }
      pendingWrites++;
      const out = fs.createWriteStream(finalPath);
      stream.on('limit', () => stream.resume());
      stream.pipe(out);
      out.on('error', () => {
        pendingWrites--;
        maybeDone();
      });
      out.on('finish', () => {
        req.file = {
          fieldname: name,
          originalname: filename,
          path: finalPath,
          size: out.bytesWritten,
        };
        pendingWrites--;
        maybeDone();
      });
    });

    bb.on('finish', () => {
      parseDone = true;
      maybeDone();
    });
    bb.on('error', () => {
      parseDone = true;
      maybeDone();
    });

    req.pipe(bb);
  };
}

// Newer multer pipeline for the warehouse XML import (buffered, small files).
const xmlUploader = multer({ storage: multer.memoryStorage() }).single('xmlfile');

module.exports = { legacyUploadSingle, xmlUploader, UPLOAD_DIR };
