// ==UserScript==
// @name         Shogo Auto Post
// @namespace    Accounting Esc
// @version      TEST
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

    function getRows() {
        let rows = document.querySelectorAll('.k-grid-content table tbody tr');
        if (!rows.length) rows = document.querySelectorAll('.k-grid-content tbody tr');
        return rows;
    }
    function getStatusFromRow(row) {
        let status = "";
        for (let cell of row.cells) {
            let txt = cell.innerText.trim().toUpperCase();
            if (txt && txt.length > 0 && txt.length < 20 && /^[A-Z]+$/.test(txt)) {
                status = txt;
            }
        }
        return status;
    }
    function updateDateList(filter) {
        const list = document.getElementById("dateList");
        if (!list) return 0;
        list.innerHTML = "";
        const rows = getRows();
        if (!rows.length) {
            list.innerHTML = "<p>No dates found.</p>";
            return 0;
        }
        let idx = 0;
        Array.from(rows).forEach(row => {
            const dateCell = row.cells[0];
            const countCell = row.cells[1];
            if (!dateCell || !countCell) return;
            const dateStr = dateCell.innerText.trim();
            const count = parseInt(countCell.innerText.trim(), 10);
            if (isNaN(count) || count === 0) return;
            const status = getStatusFromRow(row);
            if (!status) return;
            if (filter && status !== filter) return;
            const urlEl = row.querySelector('td a[href*="/sales/summary"]');
            if (!urlEl) return;
            let url = urlEl.href;
            if (!url.includes("#tab_accounting")) url += "#tab_accounting";
            const item = document.createElement("div");
            item.style.marginBottom = "5px";
            item.innerHTML = `<input type="checkbox" id="chk_${idx}" data-url="${encodeURIComponent(url)}" checked>
                              <label for="chk_${idx}">${dateStr} - ${status}</label>`;
            list.appendChild(item);
            idx++;
        });
        if (idx === 0) {
            list.innerHTML = filter ? `<p>No dates found for status "${filter}".</p>` : `<p>No dates found.</p>`;
        }
        return idx;
    }
    const updateDateListUnfiltered = () => updateDateList(null);
    const updateDateListFiltered = () => {
        const filterStatus = document.getElementById("statusFrom").value.trim().toUpperCase();
        if (!filterStatus) {
            updateDateList(null);
        } else {
            updateDateList(filterStatus);
        }
    };

    // da sauce
    function updateStatusForElement(statusEl) {
        return new Promise((resolve, reject) => {
            const fromVal = localStorage.getItem("statusFrom").toUpperCase();
            const toVal = localStorage.getItem("statusTo").toUpperCase();
            if (!statusEl) return reject("No bueno - no status element");
            if (statusEl.textContent.trim().toUpperCase() !== fromVal) return resolve();

            const pk = statusEl.id || statusEl.getAttribute("data-pk");
            if (!pk) return reject("No bueno - no ID found for status element");

            const fullUrl = "https://app.shogo.io/sales/updateJournalEntry";
            const params = new URLSearchParams();
            params.append("name", pk);
            params.append("value", toVal);
            params.append("pk", pk);

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
                statusEl.textContent = toVal;
                statusEl.setAttribute("data-value", toVal);
                resolve();
            })
            .catch(err => reject(err));
        });
    }
    async function updateAllStatusesConcurrently() {
        const fromVal = localStorage.getItem("statusFrom").toUpperCase();
        const statuses = Array.from(document.querySelectorAll('.postingStatus'))
            .filter(el => el.textContent.trim().toUpperCase() === fromVal);
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
                fontFamily: "Arial, sans-serif",
                fontSize: "16px",
                padding: "8px",
                background: "rgba(255,255,255,0.9)",
                border: "1px solid #ccc",
                borderRadius: "8px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
            });
            document.body.appendChild(indicator);
        }
        function updateSummaryState(state) {
            if (state === "posting") {
                indicator.innerHTML = '<img src="' + STATE_IMAGES.posting + '" style="width:24px; height:24px; vertical-align:middle; margin-right:8px;">Auto posting...';
            } else if (state === "done") {
                indicator.innerHTML = '<img src="' + STATE_IMAGES.done + '" style="width:24px; height:24px; vertical-align:middle; margin-right:8px;">Done posting!';
            }
        }
        updateSummaryState("posting");
        try {
            await waitForElement('.postingStatus', 10000);
            await updateAllStatusesConcurrently();
        } catch (e) {
            console.error("No bueno - error during status update:", e);
        }
        let remaining = JSON.parse(localStorage.getItem("dateLinks") || "[]").length;
        if (remaining === 0) {
            updateSummaryState("done");
            await sleep(1500);
        }
        if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
        openNextEntry();
    }
    // collapsible GUI
    function createGUI() {
        let panel = document.getElementById("autoPostGUI");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "autoPostGUI";
            Object.assign(panel.style, {
                position: "fixed",
                bottom: "20px",
                right: "20px",
                width: "320px",
                maxHeight: "70vh",
                background: "rgba(255,255,255,0.95)",
                border: "1px solid #ccc",
                borderRadius: "12px",
                zIndex: "10000",
                boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                fontSize: "14px",
                color: "#333",
                transition: "all 0.3s ease"
            });
            panel.innerHTML =
                '<div id="guiHeader" style="display:flex; align-items:center; justify-content:space-between; padding:15px; background:#f8f9fa; border-bottom:1px solid #ddd; border-radius:12px 12px 0 0; cursor:pointer;">' +
                    '<div style="display:flex; align-items:center;">' +
                        '<img id="guiStateImg" src="' + STATE_IMAGES.waiting + '" style="width:24px; height:24px; margin-right:8px;"/>' +
                        '<span id="guiState" style="font-weight:bold;">Waiting on dates</span>' +
                    '</div>' +
                    '<span id="collapseBtn" style="font-size:18px; font-weight:bold; user-select:none;">−</span>' +
                '</div>' +
                '<div id="guiContent" style="padding:15px; max-height:calc(70vh - 60px); overflow-y:auto;">' +
                    '<div id="statusConversion" style="margin-bottom:15px;">' +
                        '<div style="margin-bottom:8px;">' +
                            '<label for="statusFrom" style="display:block; margin-bottom:4px; font-weight:500;">From Status:</label> ' +
                            '<input type="text" id="statusFrom" list="statusFromList" value="" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; font-size:13px;" placeholder="Select or type status"/>' +
                            '<datalist id="statusFromList">' +
                                '<option value="POST">' +
                                '<option value="UPDATE">' +
                                '<option value="NONE">' +
                                '<option value="POSTED">' +
                                '<option value="UPDATED">' +
                                '<option value="HOLD">' +
                                '<option value="AWAITING_SYNC">' +
                            '</datalist>' +
                        '</div>' +
                        '<div style="margin-bottom:8px;">' +
                            '<label for="statusTo" style="display:block; margin-bottom:4px; font-weight:500;">To Status:</label> ' +
                            '<input type="text" id="statusTo" list="statusToList" value="" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; font-size:13px;" placeholder="Select or type status"/>' +
                            '<datalist id="statusToList">' +
                                '<option value="POST">' +
                                '<option value="UPDATE">' +
                                '<option value="NONE">' +
                                '<option value="POSTED">' +
                                '<option value="UPDATED">' +
                                '<option value="HOLD">' +
                                '<option value="AWAITING_SYNC">' +
                            '</datalist>' +
                        '</div>' +
                    '</div>' +
                    '<button id="filterStatusBtn" style="margin-bottom:10px; width:100%; padding:6px; background:#28a745; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:500;">Filter by Status</button>' +
                    '<div id="dateList" style="margin-bottom:10px; max-height:200px; overflow-y:auto; border:1px solid #e0e0e0; border-radius:4px; padding:8px;"></div>' +
                    '<div style="display:flex; justify-content:space-between; margin-bottom:10px; gap:8px;">' +
                        '<button id="selectAllBtn" style="flex:1; padding:6px; background:#007aff; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">Select All</button>' +
                        '<button id="deselectAllBtn" style="flex:1; padding:6px; background:#6c757d; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">Deselect All</button>' +
                    '</div>' +
                    '<button id="startAutoPostBtn" style="width:100%; padding:10px; background:#007aff; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600; font-size:15px;">Start Auto Post</button>' +
                '</div>';
            document.body.appendChild(panel);

            let isCollapsed = false;
            const guiContent = document.getElementById("guiContent");
            const collapseBtn = document.getElementById("collapseBtn");
            const guiHeader = document.getElementById("guiHeader");

            guiHeader.addEventListener("click", () => {
                isCollapsed = !isCollapsed;
                if (isCollapsed) {
                    guiContent.style.display = "none";
                    collapseBtn.textContent = "+";
                    panel.style.maxHeight = "auto";
                } else {
                    guiContent.style.display = "block";
                    collapseBtn.textContent = "−";
                    panel.style.maxHeight = "70vh";
                }
            });
            document.getElementById("selectAllBtn").addEventListener("click", () => {
                document.querySelectorAll("#dateList input[type='checkbox']").forEach(chk => chk.checked = true);
            });
            document.getElementById("deselectAllBtn").addEventListener("click", () => {
                document.querySelectorAll("#dateList input[type='checkbox']").forEach(chk => chk.checked = false);
            });
            document.getElementById("filterStatusBtn").addEventListener("click", updateDateListFiltered);
            document.getElementById("startAutoPostBtn").addEventListener("click", async () => {
                document.getElementById("guiState").innerText = "Auto posting...";
                document.getElementById("guiStateImg").src = STATE_IMAGES.posting;
                const fromVal = document.getElementById("statusFrom").value.trim().toUpperCase();
                const toVal = document.getElementById("statusTo").value.trim().toUpperCase();

                if (!fromVal || !toVal) {
                    alert("Please enter both 'From' and 'To' status values.");
                    return;
                }

                localStorage.setItem("statusFrom", fromVal);
                localStorage.setItem("statusTo", toVal);
                const selected = [];
                document.querySelectorAll("#dateList input[type='checkbox']").forEach(chk => {
                    if (chk.checked) selected.push(decodeURIComponent(chk.getAttribute("data-url")));
                });
                if (!selected.length) {
                    alert("Please select at least one date.");
                    return;
                }
                localStorage.setItem("dateLinks", JSON.stringify(selected));
                panel.remove();
                openNextEntry();
            });
        }
        const dateCount = updateDateListUnfiltered();
        const headerImg = panel.querySelector("#guiStateImg");
        const headerState = panel.querySelector("#guiState");
        if (headerImg && headerState) {
            if (dateCount > 0) {
                headerState.innerText = "Dates loaded";
                headerImg.src = STATE_IMAGES.dates;
            } else {
                headerState.innerText = "No dates found";
                headerImg.src = STATE_IMAGES.waiting;
            }
        }
    }

    function attachRefreshListener() {
        const refreshBtn = document.getElementById("refresh-btn");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", () => {
                setTimeout(updateDateListUnfiltered, 2000);
            });
        } else {
            console.warn("Refresh button (#refresh-btn) not found.");
        }
    }

    if (location.pathname.includes('/salesReport')) {
        waitForElement('.k-grid-content table tbody', 15000)
            .then(() => { createGUI(); attachRefreshListener(); })
            .catch(e => console.error("No bueno - table not found:", e));
    } else if (location.pathname.includes('/sales/summary')) {
        window.addEventListener("load", resumeSummary);
    }
})();
