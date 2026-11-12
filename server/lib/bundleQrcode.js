'use strict';

const fs = require('fs');
const path = require('path');

const qrcodeDir = path.resolve(__dirname, '../node_modules/qrcode');
const dijkstraDir = path.resolve(__dirname, '../node_modules/dijkstrajs');
const outputPath = path.resolve(__dirname, '../node_modules/qrcode/build/qrcode.min.js');

if (!fs.existsSync(qrcodeDir)) {
  console.log('qrcode module not found, skipping bundle.');
  process.exit(0);
}

const modules = {};

function addFile(filePath, key) {
  let code = fs.readFileSync(filePath, 'utf8');
  modules[key] = code;
}

function scan(dir, baseKey) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      scan(full, baseKey + '/' + item);
    } else if (item.endsWith('.js')) {
      const k = baseKey + '/' + item;
      addFile(full, k);
    }
  }
}

scan(path.join(qrcodeDir, 'lib'), 'qrcode/lib');
if (fs.existsSync(dijkstraDir)) {
  scan(dijkstraDir, 'dijkstrajs');
}

let bundle = '(function(root) {\n';
bundle += '  var modules = {\n';
for (const [k, code] of Object.entries(modules)) {
  bundle += '    ' + JSON.stringify(k) + ': function(require, module, exports) {\n' + code + '\n    },\n';
}
bundle += '  };\n';
bundle += '  var cache = {};\n';
bundle += '  function requireMod(id, from) {\n';
bundle += '    var target = id;\n';
bundle += '    if (id === "dijkstrajs") target = "dijkstrajs/dijkstra.js";\n';
bundle += '    else if (id.startsWith("./") || id.startsWith("../")) {\n';
bundle += '      var parts = from.split("/");\n';
bundle += '      parts.pop();\n';
bundle += '      var segs = id.split("/");\n';
bundle += '      for (var i = 0; i < segs.length; i++) {\n';
bundle += '        if (segs[i] === ".") continue;\n';
bundle += '        if (segs[i] === "..") parts.pop();\n';
bundle += '        else parts.push(segs[i]);\n';
bundle += '      }\n';
bundle += '      target = parts.join("/");\n';
bundle += '      if (!target.endsWith(".js")) target += ".js";\n';
bundle += '    }\n';
bundle += '    if (cache[target]) return cache[target].exports;\n';
bundle += '    if (!modules[target]) throw new Error("Module not found: " + target + " from " + from);\n';
bundle += '    var m = { exports: {} };\n';
bundle += '    cache[target] = m;\n';
bundle += '    modules[target](function(nextId) { return requireMod(nextId, target); }, m, m.exports);\n';
bundle += '    return m.exports;\n';
bundle += '  }\n';
bundle += '  var QRCode = requireMod("qrcode/lib/browser.js", "qrcode/lib");\n';
bundle += '  root.QRCode = QRCode;\n';
bundle += '})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));\n';

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, bundle, 'utf8');

console.log('Successfully bundled standalone QRCode into:', outputPath);

