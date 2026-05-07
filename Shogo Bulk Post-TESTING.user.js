// ==UserScript==
// @name         Shogo Auto Post
// @namespace    Accounting Esc
// @version      TEST.6
// @description  On the Sales Report page, select dates using a collapsible GUI with custom status input. On the Sales Summary page, update statuses via direct API calls.
// @match        https://app.shogo.io/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Super duper important pepe gifs
    const STATE_IMAGES = {
        waiting: "https://media.tenor.com/2NRtE9OCeKUAAAAi/pepe-tea.gif",
        dates:   "https://media.tenor.com/EuefRl2d6bsAAAAi/pepedetective-detective.gif",
        posting: "https://media1.tenor.com/m/OpuD_5Bf1y8AAAAC/nerding-speech-bubble.gif",
        done:    "https://media.tenor.com/Vw2sr_UWA6cAAAAi/pepo-party-celebrate.gif"
    };

    // Field names from the /salesReport/summary API response
    const STATUS_FIELDS = {
        sales: 'postingStatus',
        drawer: 'drawerStatus'
    };

    const ALL_STATUSES = [
        'UPDATEOOB','UPDATEFAILED','UPDATEHOLD','UPDATED','UPDATE',
        'OOB','FAILED','BATCHHOLD','PARENT','OPENCHECK','HOLD','CLEAR','LINK',
        'POSTED','POST','NONE','DELETEFAILED','DELETE','DELETED','AWAITING_SYNC'
    ];

    const GUI_STATES = {
        waiting: { img: 'waiting', label: 'Waiting on dates' },
        loading: { img: 'dates',   label: 'Loading dates…' },
        ready:   { img: 'dates',   label: null },
        empty:   { img: 'waiting', label: 'No dates found' },
        error:   { img: 'waiting', label: null },
        posting: { img: 'posting', label: 'Auto posting…' },
        done:    { img: 'done',    label: 'Done!' }
    };

    function setGuiState(name, customLabel) {
        const cfg = GUI_STATES[name];
        if (!cfg) return;
        const img = document.getElementById('guiStateImg');
        const label = document.getElementById('guiState');
        if (img) img.src = STATE_IMAGES[cfg.img];
        if (label) label.textContent = customLabel || cfg.label || '';
    }

    const STATUS_COLOR_GROUPS = {
        ok:   ['POSTED','UPDATED','DELETED','CLEAR'],
        err:  ['FAILED','UPDATEFAILED','DELETEFAILED','OOB','UPDATEOOB'],
        warn: ['HOLD','BATCHHOLD','UPDATEHOLD','OPENCHECK'],
        info: ['AWAITING_SYNC','LINK','PARENT']
    };
    const STATUS_COLOR_PALETTE = {
        ok:      { bg: '#f0fdf4', fg: '#15803d', border: '#bbf7d0' },
        err:     { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
        warn:    { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' },
        info:    { bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' },
        neutral: { bg: '#fafafa', fg: '#000',    border: '#eaeaea' }
    };
    function statusColors(status) {
        for (const [group, list] of Object.entries(STATUS_COLOR_GROUPS)) {
            if (list.includes(status)) return STATUS_COLOR_PALETTE[group];
        }
        return STATUS_COLOR_PALETTE.neutral;
    }
    function pillStyle(status) {
        const c = statusColors(status);
        return `font-family:ui-monospace,'SF Mono',Menlo,monospace; font-size:11px; padding:1px 6px; background:${c.bg}; color:${c.fg}; border:1px solid ${c.border}; border-radius:3px; white-space:nowrap;`;
    }

    let summaryPromise = null;
    function invalidateSummary() { summaryPromise = null; }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function waitForElement(selector, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(100);
        }
        throw new Error("No bueno - timeout waiting for: " + selector);
    }

    function openNextEntry() {
        let links = JSON.parse(localStorage.getItem("dateLinks") || "[]");
        if (!links.length) {
            localStorage.removeItem("dateLinks");
            window.location.href = "/salesReport/index#tab_accounting";
            return;
        }
        const nextUrl = links.shift();
        localStorage.setItem("dateLinks", JSON.stringify(links));
        window.location.href = nextUrl;
    }

    function getStoreId() {
        return document.querySelector('#store')?.value || '';
    }

    function getDateRangeInput() {
        return Array.from(document.querySelectorAll('input'))
            .find(i => /^\d{4}-\d{2}-\d{2}\s*-\s*\d{4}-\d{2}-\d{2}$/.test(i.value));
    }

    async function waitForPrereqs(timeout = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (getStoreId() && getDateRangeInput()) return;
            await sleep(100);
        }
        throw new Error("No bueno - timeout waiting for store/date inputs");
    }

    async function fetchSummary() {
        const storeId = getStoreId();
        const dateInput = getDateRangeInput();
        if (!storeId || !dateInput) return [];
        const m = dateInput.value.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/);
        if (!m) throw new Error("No bueno - couldn't parse date range: " + dateInput.value);
        const [, startDate, endDate] = m;
        const url = `/salesReport/summary?storeId=${encodeURIComponent(storeId)}` +
                    `&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
        const resp = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error("No bueno - summary fetch failed: " + resp.statusText);
        const data = await resp.json();
        return data.filter(d => d.customerCount > 0 && d.id !== -1);
    }

    function ensureSummary() {
        if (!summaryPromise) {
            summaryPromise = fetchSummary().catch(err => {
                summaryPromise = null;
                throw err;
            });
        }
        return summaryPromise;
    }

    function renderSummaryRollup(data, field) {
        const wrap = document.getElementById("dateSummary");
        if (!wrap) return;
        const counts = {};
        data.forEach(d => {
            const s = (d[field] || "").toUpperCase();
            if (s) counts[s] = (counts[s] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const total = sorted.reduce((a, [, n]) => a + n, 0);
        if (!total) { wrap.innerHTML = ""; return; }
        const pills = sorted.map(([s, n]) =>
            `<span style="${pillStyle(s)}">${s} ${n}</span>`
        ).join(" ");
        wrap.innerHTML = `<span style="font-size:11px; color:#666; margin-right:6px;">${total} total</span>${pills}`;
    }

    async function updateDateList(filter) {
        const list = document.getElementById("dateList");
        if (!list) return 0;
        setGuiState("loading");
        list.innerHTML = `<p style="color:#666; padding:8px; margin:0; font-size:13px;">Loading…</p>`;

        let data;
        try {
            data = await ensureSummary();
        } catch (e) {
            setGuiState("error", `Error: ${e.message}`);
            list.innerHTML = `<p style="color:#666; padding:8px; margin:0; font-size:13px;">Error: ${e.message}</p>`;
            updateStartButton();
            return 0;
        }

        const columnSelect = document.getElementById("statusColumn");
        const field = (columnSelect && STATUS_FIELDS[columnSelect.value]) || STATUS_FIELDS.sales;
        renderSummaryRollup(data, field);

        list.innerHTML = "";
        if (!data.length) {
            setGuiState("empty");
            list.innerHTML = `<p style="color:#666; padding:8px; margin:0; font-size:13px;">No dates found.</p>`;
            updateStartButton();
            return 0;
        }

        let idx = 0;

        data.forEach(d => {
            const status = (d[field] || "").toUpperCase();
            if (!status) return;
            if (filter && status !== filter) return;

            const url = `${location.origin}/sales/summary?storeId=${encodeURIComponent(d.storeId)}` +
                        `&startDate=${encodeURIComponent(d.salesDate)}` +
                        `&endDate=${encodeURIComponent(d.salesDate)}#tab_accounting`;

            const item = document.createElement("div");
            item.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid #f5f5f5;";
            item.innerHTML = `<input type="checkbox" id="chk_${idx}" data-url="${encodeURIComponent(url)}" checked style="margin:0; cursor:pointer; accent-color:#000;">` +
                             `<label for="chk_${idx}" style="flex:1; font-size:13px; color:#000; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:8px;">` +
                                `<span>${d.salesDate}</span>` +
                                `<span style="${pillStyle(status)}">${status}</span>` +
                             `</label>`;
            list.appendChild(item);
            idx++;
        });

        if (idx === 0) {
            setGuiState("empty", filter ? `No dates for "${filter}"` : "No dates found");
            list.innerHTML = filter
                ? `<p style="color:#666; padding:8px; margin:0; font-size:13px;">No dates for "${filter}".</p>`
                : `<p style="color:#666; padding:8px; margin:0; font-size:13px;">No dates found.</p>`;
            updateStartButton();
            return 0;
        }

        setGuiState("ready", `${idx} date${idx === 1 ? "" : "s"} ready`);
        updateStartButton();
        return idx;
    }

    function updateStartButton() {
        const btn = document.getElementById("startAutoPostBtn");
        if (!btn) return;
        if (btn.dataset.confirming === "1") return;
        const selected = document.querySelectorAll("#dateList input[type='checkbox']:checked").length;
        if (selected === 0) {
            btn.disabled = true;
            btn.style.opacity = "0.5";
            btn.style.cursor = "not-allowed";
            btn.textContent = "Start auto post";
        } else {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
            btn.textContent = `Start auto post · ${selected} selected`;
        }
    }

    function updateGuiSubtitle() {
        const sub = document.getElementById("guiSubtitle");
        if (!sub) return;
        const dateInput = getDateRangeInput();
        sub.textContent = dateInput ? dateInput.value.replace(/\s*-\s*/, " → ") : "";
    }

    const updateDateListUnfiltered = () => updateDateList(null);
    const updateDateListFiltered = () => {
        const filterStatus = document.getElementById("statusFrom").value.trim().toUpperCase();
        if (!filterStatus) {
            return updateDateList(null);
        } else {
            return updateDateList(filterStatus);
        }
    };

    // da sauce
    function updateStatusForElement(statusEl) {
        return new Promise((resolve, reject) => {
            const fromVal = localStorage.getItem("statusFrom").toUpperCase();
            const toVal = localStorage.getItem("statusTo").toUpperCase();
            if (!statusEl) return reject("No bueno - no status element");
            if ((statusEl.value || "").toUpperCase() !== fromVal) return resolve();

            const pk = statusEl.getAttribute("data-pk");
            if (!pk) return reject("No bueno - no data-pk found for status element");

            const endpoint = statusEl.getAttribute("data-url") || "updateReceipt";
            const fullUrl = "https://app.shogo.io/sales/" + endpoint;
            const params = new URLSearchParams();
            if (endpoint === "updateJournalEntry") {
                params.append("pk", pk);
                params.append("value", toVal);
            } else {
                params.append("0[name]", pk);
                params.append("0[value]", toVal);
            }

            fetch(fullUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
                body: params.toString()
            })
            .then(response => {
                if (!response.ok) throw new Error("No bueno - update failed: " + response.statusText);
                return response.text();
            })
            .then(() => {
                statusEl.value = toVal;
                statusEl.dispatchEvent(new Event("change", { bubbles: true }));
                resolve();
            })
            .catch(err => reject(err));
        });
    }
    async function updateAllStatusesConcurrently() {
        const fromVal = localStorage.getItem("statusFrom").toUpperCase();
        const statuses = Array.from(document.querySelectorAll('.postingStatus'))
            .filter(el => (el.value || "").toUpperCase() === fromVal);
        await Promise.all(statuses.map(el => updateStatusForElement(el)));
    }

    async function resumeSummary() {
        let indicator = document.getElementById("summaryStateIndicator");
        if (!indicator) {
            indicator = document.createElement("div");
            indicator.id = "summaryStateIndicator";
            Object.assign(indicator.style, {
                position: "fixed",
                top: "20px",
                right: "20px",
                zIndex: "10000",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                fontSize: "13px",
                fontWeight: "500",
                color: "#000",
                padding: "10px 14px",
                background: "#fff",
                border: "1px solid #eaeaea",
                borderRadius: "6px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)",
                display: "flex",
                alignItems: "center",
                gap: "8px"
            });
            document.body.appendChild(indicator);
        }
        function updateSummaryState(state, msg) {
            const states = {
                posting: { img: STATE_IMAGES.posting, label: "Auto posting…" },
                done:    { img: STATE_IMAGES.done,    label: "Done posting!" },
                error:   { img: STATE_IMAGES.waiting, label: msg || "Error during posting" }
            };
            const cfg = states[state];
            if (!cfg) return;
            indicator.innerHTML = `<img src="${cfg.img}" style="width:20px; height:20px;">` +
                                  `<span>${cfg.label}</span>`;
        }
        updateSummaryState("posting");
        let hadError = false;
        try {
            await waitForElement('.postingStatus', 10000);
            await updateAllStatusesConcurrently();
        } catch (e) {
            hadError = true;
            console.error("No bueno - error during status update:", e);
            updateSummaryState("error", `Error: ${e.message || e}`);
            await sleep(1500);
        }
        let remaining = JSON.parse(localStorage.getItem("dateLinks") || "[]").length;
        if (remaining === 0 && !hadError) {
            updateSummaryState("done");
            await sleep(1500);
        }
        if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
        openNextEntry();
    }

    // collapsible GUI
    async function createGUI() {
        let panel = document.getElementById("autoPostGUI");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "autoPostGUI";
            Object.assign(panel.style, {
                position: "fixed",
                bottom: "20px",
                right: "20px",
                width: "340px",
                maxHeight: "70vh",
                background: "#fff",
                border: "1px solid #eaeaea",
                borderRadius: "6px",
                zIndex: "10000",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                fontSize: "14px",
                color: "#000",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column"
            });

            const labelStyle = "display:block; margin-bottom:6px; font-size:11px; color:#666; text-transform:uppercase; letter-spacing:0.04em; font-weight:500;";
            const inputStyle = "width:100%; padding:8px 10px; border:1px solid #eaeaea; border-radius:4px; font-size:13px; background:#fff; color:#000; outline:none; box-sizing:border-box; font-family:inherit;";
            const primaryBtnStyle = "width:100%; padding:9px; background:#000; color:#fff; border:1px solid #000; border-radius:4px; cursor:pointer; font-weight:500; font-size:13px; font-family:inherit; transition:background 0.1s, border-color 0.1s;";
            const secondaryBtnStyle = "flex:1; padding:7px; background:#fff; color:#000; border:1px solid #eaeaea; border-radius:4px; cursor:pointer; font-size:12px; font-family:inherit;";
            const iconBtnStyle = "background:transparent; border:none; cursor:pointer; padding:4px; color:#666; display:inline-flex; align-items:center; justify-content:center; border-radius:4px; line-height:1;";

            const statusOptions = ALL_STATUSES.map(s => `<option value="${s}">`).join('');

            panel.innerHTML =
                `<style>
                    #autoPostGUI input:focus, #autoPostGUI select:focus { border-color:#000; }
                    #autoPostGUI button[data-variant="primary"]:not(:disabled):not([data-confirming="1"]):hover { background:#333; border-color:#333; }
                    #autoPostGUI button[data-variant="secondary"]:hover { background:#fafafa; }
                    #autoPostGUI button[data-variant="icon"]:hover { background:#fafafa; color:#000; }
                    #autoPostGUI #dateList::-webkit-scrollbar, #autoPostGUI #guiContent::-webkit-scrollbar { width:6px; }
                    #autoPostGUI #dateList::-webkit-scrollbar-thumb, #autoPostGUI #guiContent::-webkit-scrollbar-thumb { background:#eaeaea; border-radius:3px; }
                </style>` +
                `<div id="guiHeader" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid #eaeaea; user-select:none; flex-shrink:0;">` +
                    `<div id="guiHeaderLabel" style="display:flex; align-items:center; gap:10px; cursor:pointer; flex:1; min-width:0;">` +
                        `<img id="guiStateImg" src="${STATE_IMAGES.waiting}" style="width:22px; height:22px; flex-shrink:0;"/>` +
                        `<div style="display:flex; flex-direction:column; min-width:0;">` +
                            `<span id="guiState" style="font-size:13px; font-weight:500; color:#000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Waiting on dates</span>` +
                            `<span id="guiSubtitle" style="font-size:11px; color:#666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></span>` +
                        `</div>` +
                    `</div>` +
                    `<div style="display:flex; align-items:center; gap:2px; flex-shrink:0;">` +
                        `<button id="refreshBtn" data-variant="icon" title="Refresh" style="${iconBtnStyle}">` +
                            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 8a5.5 5.5 0 019.4-3.9L13.5 5.5M13.5 8a5.5 5.5 0 01-9.4 3.9L2.5 10.5M13.5 2.5v3h-3M2.5 13.5v-3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
                        `</button>` +
                        `<button id="collapseBtn" data-variant="icon" title="Collapse" style="${iconBtnStyle}; font-size:14px; min-width:22px;">−</button>` +
                    `</div>` +
                `</div>` +
                `<div id="guiContent" style="padding:14px 14px 0 14px; overflow-y:auto; flex:1 1 auto; min-height:0;">` +
                    `<div style="margin-bottom:12px;">` +
                        `<label for="statusColumn" style="${labelStyle}">Column</label>` +
                        `<div style="position:relative;">` +
                            `<select id="statusColumn" style="${inputStyle} appearance:none; -webkit-appearance:none; -moz-appearance:none; padding-right:28px;">` +
                                `<option value="sales">Sales</option>` +
                                `<option value="drawer">Drawer</option>` +
                            `</select>` +
                            `<span style="position:absolute; right:10px; top:50%; transform:translateY(-50%); pointer-events:none; color:#666; font-size:9px;">▼</span>` +
                        `</div>` +
                    `</div>` +
                    `<div style="display:flex; gap:8px; margin-bottom:14px;">` +
                        `<div style="flex:1;">` +
                            `<label for="statusFrom" style="${labelStyle}">From</label>` +
                            `<input type="text" id="statusFrom" list="statusFromList" autocomplete="off" placeholder="e.g. POST" style="${inputStyle}"/>` +
                            `<datalist id="statusFromList">${statusOptions}</datalist>` +
                        `</div>` +
                        `<div style="flex:1;">` +
                            `<label for="statusTo" style="${labelStyle}">To</label>` +
                            `<input type="text" id="statusTo" list="statusToList" autocomplete="off" placeholder="e.g. POSTED" style="${inputStyle}"/>` +
                            `<datalist id="statusToList">${statusOptions}</datalist>` +
                        `</div>` +
                    `</div>` +
                    `<div id="dateSummary" style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-bottom:8px; min-height:18px;"></div>` +
                    `<div id="dateList" style="margin-bottom:12px; max-height:240px; overflow-y:auto; border:1px solid #eaeaea; border-radius:4px; background:#fff;"></div>` +
                `</div>` +
                `<div id="guiFooter" style="padding:12px 14px; border-top:1px solid #eaeaea; background:#fff; flex-shrink:0;">` +
                    `<div style="display:flex; gap:8px; margin-bottom:8px;">` +
                        `<button id="selectAllBtn" data-variant="secondary" style="${secondaryBtnStyle}">Select all</button>` +
                        `<button id="deselectAllBtn" data-variant="secondary" style="${secondaryBtnStyle}">Deselect all</button>` +
                    `</div>` +
                    `<button id="startAutoPostBtn" data-variant="primary" style="${primaryBtnStyle}">Start auto post</button>` +
                `</div>`;
            document.body.appendChild(panel);

            let isCollapsed = false;
            const guiContent = document.getElementById("guiContent");
            const guiFooter = document.getElementById("guiFooter");
            const collapseBtn = document.getElementById("collapseBtn");
            const guiHeaderLabel = document.getElementById("guiHeaderLabel");

            const toggleCollapse = () => {
                isCollapsed = !isCollapsed;
                guiContent.style.display = isCollapsed ? "none" : "";
                guiFooter.style.display = isCollapsed ? "none" : "";
                collapseBtn.textContent = isCollapsed ? "+" : "−";
            };
            guiHeaderLabel.addEventListener("click", toggleCollapse);
            collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleCollapse(); });

            // Manual refresh button — invalidate cache, re-render subtitle, refetch
            document.getElementById("refreshBtn").addEventListener("click", (e) => {
                e.stopPropagation();
                invalidateSummary();
                updateGuiSubtitle();
                const filterStatus = document.getElementById("statusFrom").value.trim().toUpperCase();
                if (filterStatus) updateDateListFiltered(); else updateDateListUnfiltered();
            });

            // Re-filter when column changes
            document.getElementById("statusColumn").addEventListener("change", () => {
                const filterStatus = document.getElementById("statusFrom").value.trim().toUpperCase();
                if (filterStatus) {
                    updateDateListFiltered();
                } else {
                    updateDateListUnfiltered();
                }
            });

            // Auto-filter as user types/picks From status (debounced)
            let filterDebounce;
            document.getElementById("statusFrom").addEventListener("input", () => {
                clearTimeout(filterDebounce);
                filterDebounce = setTimeout(updateDateListFiltered, 150);
            });

            document.getElementById("selectAllBtn").addEventListener("click", () => {
                document.querySelectorAll("#dateList input[type='checkbox']").forEach(chk => chk.checked = true);
                updateStartButton();
            });
            document.getElementById("deselectAllBtn").addEventListener("click", () => {
                document.querySelectorAll("#dateList input[type='checkbox']").forEach(chk => chk.checked = false);
                updateStartButton();
            });

            // Track per-checkbox toggles via event delegation
            document.getElementById("dateList").addEventListener("change", updateStartButton);

            // Confirmation flow on Start
            const startBtn = document.getElementById("startAutoPostBtn");
            let confirmTimer = null;
            const exitConfirmMode = () => {
                if (confirmTimer) clearTimeout(confirmTimer);
                confirmTimer = null;
                startBtn.dataset.confirming = "0";
                startBtn.style.background = "#000";
                startBtn.style.borderColor = "#000";
                updateStartButton();
            };
            startBtn.addEventListener("click", () => {
                if (startBtn.disabled) return;
                const fromVal = document.getElementById("statusFrom").value.trim().toUpperCase();
                const toVal = document.getElementById("statusTo").value.trim().toUpperCase();

                if (!fromVal || !toVal) {
                    alert("Please enter both 'From' and 'To' status values.");
                    return;
                }

                const selected = [];
                document.querySelectorAll("#dateList input[type='checkbox']").forEach(chk => {
                    if (chk.checked) selected.push(decodeURIComponent(chk.getAttribute("data-url")));
                });
                if (!selected.length) {
                    alert("Please select at least one date.");
                    return;
                }

                if (startBtn.dataset.confirming === "1") {
                    // 2nd click — proceed
                    exitConfirmMode();
                    setGuiState("posting");
                    localStorage.setItem("statusFrom", fromVal);
                    localStorage.setItem("statusTo", toVal);
                    localStorage.setItem("dateLinks", JSON.stringify(selected));
                    panel.remove();
                    openNextEntry();
                    return;
                }

                // 1st click — enter confirm mode
                startBtn.dataset.confirming = "1";
                startBtn.style.background = "#0070f3";
                startBtn.style.borderColor = "#0070f3";
                startBtn.textContent = `Confirm: ${fromVal} → ${toVal} on ${selected.length} date${selected.length === 1 ? "" : "s"}`;
                confirmTimer = setTimeout(exitConfirmMode, 2500);
            });
        }
        updateGuiSubtitle();
        await updateDateListUnfiltered();
    }

    function attachRefreshListener() {
        const refreshBtn = document.getElementById("refresh-btn");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", () => {
                invalidateSummary();
                setTimeout(() => { updateGuiSubtitle(); updateDateListUnfiltered(); }, 500);
            });
        } else {
            console.warn("Refresh button (#refresh-btn) not found.");
        }
    }

    if (location.pathname.includes('/salesReport')) {
        waitForPrereqs(15000)
            .then(() => {
                ensureSummary().catch(() => {}); // kick off fetch in parallel with panel build
                createGUI();
                attachRefreshListener();
            })
            .catch(e => console.error("No bueno - prerequisites not found:", e));
    } else if (location.pathname.includes('/sales/summary')) {
        window.addEventListener("load", resumeSummary);
    }
})();
