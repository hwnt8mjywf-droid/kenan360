// Connects the Lineup Studio page to the site's own storage (/api/studio).
// It provides the small db / assets / downloads interface the page was written against,
// and asks for the CRM password once (shared with /crm).
(function () {
  "use strict";
  var KEY = "k360crm";
  var pw = "";
  try { pw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || ""; } catch (e) {}

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "x-crm-key": pw }, opts.headers || {});
    return fetch("/api/studio" + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || "error"); e.code = r.status === 413 ? "too_large" : r.status === 415 ? "unsupported_type" : r.status === 401 ? "unauthorized" : (j.error || "error"); e.message = j.error || e.code; throw e; }
        return j;
      });
    });
  }

  function gate() {
    return new Promise(function (resolve) {
      var box = document.createElement("div");
      box.setAttribute("role", "dialog");
      box.style.cssText = "position:fixed;inset:0;z-index:50;background:rgba(28,18,12,.55);display:grid;place-items:center;padding:16px";
      box.innerHTML = '<form style="background:#fff;color:#1C120C;border-radius:14px;padding:22px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px;font:14px Inter,system-ui,sans-serif">' +
        '<b style="font:900 italic 26px \'Barlow Condensed\',sans-serif">LINEUP STUDIO</b>' +
        '<span>Enter the Kenan 360 CRM password.</span>' +
        '<input type="password" autocomplete="current-password" style="font:16px Inter,sans-serif;padding:10px;border:1px solid #EBDFD6;border-radius:8px" aria-label="Password">' +
        '<span class="err" style="color:#C2341B;min-height:1em"></span>' +
        '<button style="background:#FF6A13;color:#fff;border:0;border-radius:8px;padding:12px;font:700 15px Inter,sans-serif">Open studio</button></form>';
      document.body.appendChild(box);
      var form = box.querySelector("form"), inp = box.querySelector("input");
      inp.focus();
      form.addEventListener("submit", function (e) {
        e.preventDefault(); pw = inp.value;
        api("").then(function (j) { try { localStorage.setItem(KEY, pw); } catch (e2) {} box.remove(); resolve(j); })
          .catch(function () { box.querySelector(".err").textContent = "Wrong password"; });
      });
    });
  }

  var loadP = null;
  function load() {
    if (!loadP) loadP = api("").catch(function (e) { if (e.code === "unauthorized") return gate(); throw e; });
    return loadP;
  }

  // ---- db: doc(path).set / onSnapshot, collection(name).onSnapshot ----
  var docs = {}, docSubs = {}, colSubs = {};
  function snap(path) { var d = docs[path]; return { id: path.split("/").pop(), exists: !!d, data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; }, metadata: { fromCache: false } }; }
  function colSnap(name) {
    var list = Object.keys(docs).filter(function (k) { return k.indexOf(name + "/") === 0 && k.split("/").length === 2; }).map(snap);
    return { docs: list, metadata: { fromCache: false } };
  }
  function emit(path) {
    (docSubs[path] || []).forEach(function (cb) { cb(snap(path)); });
    var col = path.split("/")[0]; (colSubs[col] || []).forEach(function (cb) { cb(colSnap(col)); });
  }
  var db = {
    doc: function (path) {
      return {
        set: function (data) { docs[path] = JSON.parse(JSON.stringify(data)); return api("", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: path, data: data }) }).then(function () { emit(path); }); },
        onSnapshot: function (cb, err) { (docSubs[path] = docSubs[path] || []).push(cb); load().then(function () { cb(snap(path)); }, err || function () {}); }
      };
    },
    collection: function (name) {
      return { onSnapshot: function (cb, err) { (colSubs[name] = colSubs[name] || []).push(cb); load().then(function () { cb(colSnap(name)); }, err || function () {}); } };
    }
  };

  var assets = {
    // Netlify functions reject request bodies over ~6 MB, so big files go up in 4 MB parts.
    upload: function (file, o) {
      var type = (o && o.type) || file.type, CH = 4 * 1024 * 1024;
      if (file.size <= CH) return api("/upload", { method: "POST", headers: { "content-type": type }, body: file });
      var n = Math.ceil(file.size / CH), up = "";
      for (var k = 0; k < 32; k++) up += "0123456789abcdef"[Math.floor(Math.random() * 16)];
      var i = 0;
      function next() {
        var q = "?up=" + up + "&part=" + i + "&of=" + n;
        return api("/upload" + q, { method: "POST", headers: { "content-type": type }, body: file.slice(i * CH, (i + 1) * CH) })
          .then(function (j) { i++; return i < n ? next() : j; });
      }
      return next();
    },
    importUrl: function (url) { return api("/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: url }) }); }
  };

  var downloads = {
    save: function (o) {
      var u = URL.createObjectURL(o.data), a = document.createElement("a");
      a.href = u; a.download = o.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
      return Promise.resolve();
    }
  };

  window.claude = {
    use: function (name) {
      if (name === "db") return load().then(function (j) { docs = j.docs || {}; return db; });
      if (name === "assets") return load().then(function () { return assets; });
      if (name === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };
})();
