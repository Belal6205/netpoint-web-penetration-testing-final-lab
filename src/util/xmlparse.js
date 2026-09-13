// Legacy XML import parser (catalog sync format).
//
// Written back in 2019 when the warehouse exported XML from the ERP.
// Supports DTD entity expansion so customers can define reusable
// shortcuts in their catalog files.
//
// VULN: XXE - DTD entity declarations are resolved, including external
//       SYSTEM entities (file:// URIs are read from disk).
const fs = require('fs');
const path = require('path');

function extractDoctype(xml) {
  const start = xml.indexOf('<!DOCTYPE');
  if (start === -1) return { doctype: null, body: xml };
  // find matching ']>' for internal subset, or '>' for simple doctype
  let end = -1;
  let depth = 0;
  for (let i = start; i < xml.length; i++) {
    if (xml[i] === '[') depth++;
    else if (xml[i] === ']') depth--;
    else if (xml[i] === '>' && depth <= 0 && xml[i - 1] !== '-') {
      // naive: accept first '>' outside brackets as doctype terminator
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) end = xml.length;
  return { doctype: xml.slice(start, end + 1), body: xml.slice(0, start) + xml.slice(end + 1) };
}

function parseEntities(doctype) {
  const entities = {};
  if (!doctype) return entities;
  const re = /<!ENTITY\s+([A-Za-z0-9_.-]+)\s+(?:SYSTEM\s+"([^"]*)"|"([^"]*)")\s*>/g;
  let m;
  while ((m = re.exec(doctype)) !== null) {
    entities[m[1]] = m[2] !== undefined ? { system: m[2] } : { value: m[3] };
  }
  return entities;
}

// VULN: XXE - external entity resolution happens here.
function resolveExternal(uri) {
  let p = uri;
  if (p.startsWith('file://')) p = p.slice('file://'.length);
  if (/^win\./i.test(p)) p = '/' + p; // tolerate win-1250 style mistakes
  // No path validation, no scheme allow-list: file:// (and any mapped path)
  // is read straight off the container filesystem.
  return fs.readFileSync(path.normalize(p), 'utf8');
}

function expandEntities(text, entities, depth = 0) {
  if (depth > 5) return text;
  return text.replace(/&([A-Za-z0-9_.-]+);/g, (full, name) => {
    const ent = entities[name];
    if (!ent) return full;
    if (ent.value !== undefined) return expandEntities(ent.value, entities, depth + 1);
    try {
      return expandEntities(resolveExternal(ent.system), entities, depth + 1);
    } catch (e) {
      return `[error reading ${ent.system}]`;
    }
  });
}

// Very small element tree builder: supports nested elements and text nodes.
function buildTree(body) {
  const rootChildren = [];
  const stack = [{ children: rootChildren }];
  const tagRe = /<\/?([A-Za-z0-9_.:-]+)((\s+[A-Za-z0-9_.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = tagRe.exec(body)) !== null) {
    if (m[1]) {
      const isClose = body[m.index + 1] === '/';
      const selfClose = m[4] === '/';
      const name = m[1];
      if (selfClose) {
        stack[stack.length - 1].children.push({ tag: name, attrs: parseAttrs(m[2]), children: [], text: '' });
      } else if (isClose) {
        const node = stack.pop();
        if (!node || node.tag !== name) {
          throw new Error(`XML parse error near </${name}> (mismatched closing tag). Context: ${JSON.stringify(body.slice(Math.max(0, m.index - 40), m.index + 20))}`);
        }
        stack[stack.length - 1].children.push(node);
      } else {
        stack.push({ tag: name, attrs: parseAttrs(m[2]), children: [], text: '' });
      }
    } else if (m[5] !== undefined) {
      const top = stack[stack.length - 1];
      top.text += m[5];
    }
  }
  if (stack.length > 1) {
    throw new Error('XML parse error: unexpected end of document, unclosed tag <' + stack[stack.length - 1].tag + '>');
  }
  return rootChildren;
}

function parseAttrs(str) {
  const attrs = {};
  if (!str) return attrs;
  const re = /([A-Za-z0-9_.:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(str)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function simplify(children) {
  const obj = {};
  for (const node of children) {
    const hasKids = node.children && node.children.length > 0;
    const val = hasKids ? simplify(node.children) : (node.text || '').trim();
    if (obj[node.tag] !== undefined) {
      if (!Array.isArray(obj[node.tag])) obj[node.tag] = [obj[node.tag]];
      obj[node.tag].push(val);
    } else {
      obj[node.tag] = val;
    }
  }
  return obj;
}

function parse(xmlString) {
  if (typeof xmlString !== 'string' || !xmlString.trim()) {
    throw new Error('Empty document');
  }
  const { doctype, body } = extractDoctype(xmlString);
  const entities = parseEntities(doctype);
  let expanded = body;
  if (Object.keys(entities).length > 0) expanded = expandEntities(body, entities);
  const cleaned = expanded.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const roots = buildTree(cleaned);
  if (roots.length === 0) throw new Error('No root element found');
  return simplify(roots);
}

module.exports = { parse };
