// ==UserScript==
// @name         Shogo Bulk Post
// @version      TESTING
// @description  Bulk POST > POSTED (other status included for TS)
// @match        https://app.shogo.io/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Super duper important Pepe GIFs
    const STATE_IMAGES = {
        waiting:  "https://media.tenor.com/2NRtE9OCeKUAAAAi/pepe-tea.gif",
        dates:    "https://media.tenor.com/EuefRl2d6bsAAAAi/pepedetective-detective.gif",
        posting:  "https://media1.tenor.com/m/OpuD_5Bf1y8AAAAC/nerding-speech-bubble.gif",
        done:     "https://media.tenor.com/Vw2sr_UWA6cAAAAi/pepo-party-celebrate.gif"
    };

    const CONFIG = {
        waitElementTimeout: 10000,
        statusColumnIndex: null,
        progressUpdateInterval: 500,
        finalEntryDisplayTime: 1000,
        useCache: true,
        cacheTTL: 5000
    };
    const CACHE = { rows: null, rowsTimestamp: 0 };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function waitForElement(selector, timeout = CONFIG.waitElementTimeout) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(100);
        }
        throw new Error(`Timeout waiting for: ${selector}`);
    }

    function openNextEntry() {
        const links = JSON.parse(localStorage.getItem("dateLinks") || "[]");
        let processed = +localStorage.getItem("processedCount") || 0;
        if (!links.length) {
            localStorage.clear();
            window.location.href = "/salesReport/index#tab_accounting";
            return;
        }
        processed++;
        localStorage.setItem("processedCount", processed);
        const next = links.shift();
        localStorage.setItem("dateLinks", JSON.stringify(links));
        window.location.href = next;
    }

    function getRows() {
        if (CONFIG.useCache && CACHE.rows && Date.now() - CACHE.rowsTimestamp < CONFIG.cacheTTL) {
            return CACHE.rows;
        }
        let rows = document.querySelectorAll('.k-grid-content table tbody tr');
        if (!rows.length) rows = document.querySelectorAll('.k-grid-content tbody tr');
        CACHE.rows = rows;
        CACHE.rowsTimestamp = Date.now();
        return rows;
    }

    function determineStatusColumnIndex(rows) {
        if (CONFIG.statusColumnIndex !== null) return CONFIG.statusColumnIndex;
        const known = ["HOLD", "POSTED", "POST"];
        if (!rows.length) return -1;
        for (let i = 0; i < rows[0].cells.length; i++) {
            if (known.includes(rows[0].cells[i].innerText.trim().toUpperCase())) {
                CONFIG.statusColumnIndex = i;
                return i;
            }
        }
        return -1;
    }

    function getStatusFromRow(row) {
        const idx = determineStatusColumnIndex(getRows());
        if (idx >= 0 && row.cells[idx]) {
            return row.cells[idx].innerText.trim().toUpperCase();
        }
        for (const c of row.cells) {
            const t = c.innerText.trim().toUpperCase();
            if (["HOLD", "POSTED", "POST"].includes(t)) return t;
        }
        return "";
    }

    function updateDateList(filter) {
        const list = document.getElementById("dateList");
        if (!list) return;
        list.innerHTML = "<p>Loading dates...</p>";
        setTimeout(() => {
            const rows = getRows();
            const frag = document.createDocumentFragment();
            let idx = 0;
            rows.forEach(r => {
                const dateStr = r.cells[0]?.innerText.trim();
                const count = +r.cells[1]?.innerText.trim();
                const status = getStatusFromRow(r);
                const urlEl = r.querySelector('td a[href*="/sales/summary"]');
                if (!dateStr || !count || !status || !urlEl) return;
                if (filter && status !== filter) return;
                const url = urlEl.href.includes('#tab_accounting') ? urlEl.href : urlEl.href + '#tab_accounting';
                const div = document.createElement("div");
                div.style.marginBottom = "6px";
                div.innerHTML = `
                    <label style="display:flex;align-items:center;">
                        <input type="checkbox" id="chk_${idx}" data-url="${encodeURIComponent(url)}" style="margin-right:8px;">
                        ${dateStr} - ${status}
                    </label>`;
                frag.appendChild(div);
                idx++;
            });
            list.innerHTML = "";
            list.appendChild(frag);
            document.getElementById("guiState").innerText = idx ? "Dates loaded" : "No dates found";
            document.getElementById("guiStateImg").src = STATE_IMAGES.dates;
        }, 0);
    }

    async function updateStatusForElement(el) {
        const from = (localStorage.getItem("statusFrom") || "POSTED").toUpperCase();
        if (el.textContent.trim().toUpperCase() !== from) return;
        const pk = el.dataset.pk;
        const endpoint = el.dataset.url;
        if (!pk || !endpoint) return;
        const params = new URLSearchParams({ pk, name: "status", value: localStorage.getItem("statusTo") || "POST" });
        try {
            const res = await fetch(`${location.origin}/sales/${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params
            });
            if (!res.ok) throw new Error(res.statusText);
            el.textContent = params.get("value");
        } catch {}
    }

    async function updateAllStatusesConcurrently() {
        const fromVal = (localStorage.getItem("statusFrom") || "POSTED").toUpperCase();
        const els = [...document.querySelectorAll('.postingStatus')].filter(e => e.textContent.trim().toUpperCase() === fromVal);
        const batch = 10;
        let done = 0;
        const ind = document.getElementById("summaryStateIndicator");
        for (let i = 0; i < els.length; i += batch) {
            await Promise.all(els.slice(i, i + batch).map(updateStatusForElement));
            done += Math.min(batch, els.length - i);
            if (ind) ind.innerHTML = `<img src="${STATE_IMAGES.posting}" style="width:24px;height:24px;vertical-align:middle;margin-right:8px;">${done}/${els.length}`;
        }
    }

    async function resumeSummary() {
        let ind = document.getElementById("summaryStateIndicator");
        if (!ind) {
            ind = document.createElement("div"); ind.id = "summaryStateIndicator";
            Object.assign(ind.style, { position: "fixed", top: "20px", right: "20px", padding: "10px", background: "#fff", border: "1px solid #ccc", borderRadius: "8px", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" });
            document.body.appendChild(ind);
        }
        ind.innerHTML = `<img src="${STATE_IMAGES.posting}" style="width:24px;height:24px;vertical-align:middle;margin-right:8px;">Starting...`;
        try { await waitForElement('.postingStatus'); } catch {}
        await updateAllStatusesConcurrently();
        const remaining = JSON.parse(localStorage.getItem("dateLinks") || "[]").length;
        if (remaining === 0) {
            ind.innerHTML = `<img src="${STATE_IMAGES.done}" style="width:24px;height:24px;vertical-align:middle;margin-right:8px;">Done!`;
            await sleep(CONFIG.finalEntryDisplayTime);
        }
        ind.remove(); openNextEntry();
    }

    function createGUI() {
        const panel = document.createElement("div");
        Object.assign(panel.style, { position: "fixed", top: "20px", right: "20px", width: "320px", background: "#f2f2f5", padding: "20px", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", fontSize: "14px", color: "#1c1c1e" });
        panel.innerHTML = `
            <div style="display:flex;align-items:center;margin-bottom:12px;"><img id="guiStateImg" src="${STATE_IMAGES.waiting}" style="width:24px;height:24px;margin-right:8px;"><span id="guiState" style="font-weight:600;">Waiting on dates</span></div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"><div style="flex:1;display:flex;align-items:center;margin-right:8px;"><span style="margin-right:4px;font-weight:500;">From:</span><select id="statusFrom" style="flex:1;padding:6px;border:1px solid #ccc;border-radius:6px;background:#fff;"><option>HOLD</option><option selected>POSTED</option><option>POST</option></select></div><div style="font-size:16px;margin:0 4px;">→</div><div style="flex:1;display:flex;align-items:center;margin-left:8px;"><span style="margin-right:4px;font-weight:500;">To:</span><select id="statusTo" style="flex:1;padding:6px;border:1px solid #ccc;border-radius:6px;background:#fff;"><option selected>POST</option><option>HOLD</option><option>POSTED</option></select></div></div>
            <button id="filterStatusBtn" style="width:100%;padding:8px;margin-bottom:12px;border:none;border-radius:6px;background:#007aff;color:#fff;cursor:pointer;">Filter</button>
            <div id="dateList" style="max-height:180px;overflow-y:auto;margin-bottom:12px;"></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><button id="selectAllBtn" style="flex:1;margin-right:8px;padding:8px;border:none;border-radius:6px;background:#e5eea;color:#1c1c1e;cursor:pointer;">Select All</button><button id="deselectAllBtn" style="flex:1;padding:8px;border:none;border-radius:6px;background:#e5e5ea;color:#1c1c1e;cursor:pointer;">Deselect All</button></div>
            <button id="startAutoPostBtn" style="width:100%;padding:10px;border:none;border-radius:6px;background:#007aff;color:#fff;cursor:pointer;">Start Auto Post</button>
        `;
        document.body.appendChild(panel);

        document.getElementById("filterStatusBtn").addEventListener("click", function() { updateDateList(document.getElementById("statusFrom").value); });
        document.getElementById("selectAllBtn").addEventListener("click", function() { document.querySelectorAll("#dateList input").forEach(function(c){ c.checked = true; }); });
        document.getElementById("deselectAllBtn").addEventListener("click", function() { document.querySelectorAll("#dateList input").forEach(function(c){ c.checked = false; }); });
        document.getElementById("startAutoPostBtn").addEventListener("click", function() {
            const fromVal = document.getElementById("statusFrom").value;
            const toVal = document.getElementById("statusTo").value;
            // Prevent no-op: same status
            if (fromVal === toVal) {
                try {
                    const boomAudio = new Audio('https://www.myinstants.com/media/sounds/vine-boom.mp3');
                    boomAudio.play();
                } catch {}
                panel.style.transition = 'background 0.3s'; panel.style.background = '#ff4d4f';
                setTimeout(function() { panel.style.background = '#f2f2f5'; }, 300);
                setTimeout(function() { alert(`Can’t change status from ${fromVal} to itself!`); }, 100);
                return;
            }
            localStorage.setItem("statusFrom", fromVal);
            localStorage.setItem("statusTo", toVal);
            const urls = Array.from(document.querySelectorAll("#dateList input:checked")).map(function(c) { return decodeURIComponent(c.dataset.url); });
            if (!urls.length) return alert("Pick at least one date!");
            localStorage.setItem("dateLinks", JSON.stringify(urls));
            localStorage.setItem("totalCount", urls.length);
            localStorage.setItem("processedCount", 0);
            panel.remove();
            openNextEntry();
        });
    }

    function init() {
        const path = location.pathname;
        if (path.includes('/salesReport')) {
            waitForElement('.k-grid-content tbody').then(createGUI).catch(function(){ alert('Load failed!'); });
        } else if (path.includes('/sales/summary')) {
            window.addEventListener('load', resumeSummary);
            setTimeout(resumeSummary, CONFIG.waitElementTimeout + 5000);
        }
    }

    init();
})();
