window.top.addEventListener("load", e => {
  ui.bindButtons();
}, true);

ui = {
  tracer: null,

  bindButtons: () => {
    document.getElementById("button-unmute-all").addEventListener("click", () => {
      if (ui.tracer.muteRules.clear()) {
        ui.commit();
      }
    }, true);
  },

  /** Writes the rules through and brings both the dialog and the request list back in step. */
  commit: () => {
    ui.tracer.muteRules.save();
    ui.tracer.applyMuteRules();
    ui.render();
  },

  setupContent: tracer => {
    ui.tracer = tracer;
    ui.render();
  },

  render: () => {
    const rules = ui.tracer.muteRules.rules;
    const table = document.getElementById("mute-rules");
    table.innerText = "";

    document.getElementById("mute-empty").style.display = rules.length === 0 ? "block" : "none";
    document.getElementById("button-unmute-all").classList.toggle("inactive", rules.length === 0);

    // How many captured entries each rule actually accounts for. A rule that hides nothing in the
    // current trace is usually one left over from an earlier session, and worth seeing as such.
    const matchCount = rule => ui.tracer.httpRequests
      .filter(entry => entry.parsed && MuteRules.matches(rule, entry.parsed))
      .length;

    rules.forEach(rule => {
      const key = MuteRules.key(rule);

      const labelCell = document.createElement("td");
      labelCell.classList.add("mute-label");
      labelCell.innerText = MuteRules.label(rule);

      const countCell = document.createElement("td");
      countCell.classList.add("mute-count");
      const hidden = matchCount(rule);
      countCell.innerText = hidden === 1 ? "1 entry" : `${hidden} entries`;

      const actionCell = document.createElement("td");
      actionCell.classList.add("mute-actions");

      if (rule.scope !== MuteRules.HOST) {
        const broaden = document.createElement("a");
        broaden.classList.add("button");
        broaden.innerText = "Whole host";
        broaden.title = `Hide everything from ${rule.host}`;
        broaden.addEventListener("click", () => {
          if (ui.tracer.muteRules.broaden(key)) {
            ui.commit();
          }
        }, true);
        actionCell.appendChild(broaden);
      }

      const unmute = document.createElement("a");
      unmute.classList.add("button");
      unmute.innerText = "Unmute";
      unmute.addEventListener("click", () => {
        if (ui.tracer.muteRules.remove(key)) {
          ui.commit();
        }
      }, true);
      actionCell.appendChild(unmute);

      const row = document.createElement("tr");
      row.appendChild(labelCell);
      row.appendChild(countCell);
      row.appendChild(actionCell);
      table.appendChild(row);
    });

    // The dialog is an iframe sized to its content by the parent window.
    window.parent.ui.resizeDialogs();
  }
};
