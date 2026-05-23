// Builds DOM inside `body` from obj.ui spec. Returns refresher and cleanup
// callbacks so the animate loop can sync displays when params change.
export function buildInspectorUI(body, obj, opcuaClient = null) {
  body.innerHTML = '';
  const refreshers = [];
  const cleanups = [];

  const fmtDefault = (value) => typeof value === 'number' ? value.toFixed(2) : String(value);

  for (const item of obj.ui) {
    const row = document.createElement('div');
    row.className = 'insp-row';

    if (item.type === 'slider') {
      const label = document.createElement('label');
      const name = document.createElement('span'); name.textContent = item.label;
      const val = document.createElement('span'); val.className = 'insp-val';
      const fmt = item.format ?? fmtDefault;
      val.textContent = fmt(obj.params[item.param]);
      label.appendChild(name); label.appendChild(val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = item.min; input.max = item.max; input.step = item.step;
      input.value = obj.params[item.param];
      input.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value);
        obj.setParam(item.param, value);
        val.textContent = fmt(value);
      });
      row.appendChild(label); row.appendChild(input);
      refreshers.push(() => {
        const value = obj.params[item.param];
        if (parseFloat(input.value) !== value) input.value = value;
        val.textContent = fmt(value);
      });
    } else if (item.type === 'toggle') {
      const label = document.createElement('label'); label.className = 'insp-toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!obj.params[item.param];
      input.addEventListener('change', (event) => {
        obj.setParam(item.param, event.target.checked);
      });
      const name = document.createElement('span'); name.textContent = item.label;
      label.appendChild(input); label.appendChild(name);
      row.appendChild(label);
      refreshers.push(() => { input.checked = !!obj.params[item.param]; });
    } else if (item.type === 'button') {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.addEventListener('click', item.action);
      row.appendChild(btn);
    } else if (item.type === 'toggleButton') {
      const btn = document.createElement('button');
      btn.className = 'insp-toggle-btn';
      const syncLabel = () => {
        const on = !!obj.params[item.param];
        btn.textContent = on ? item.labelOn : item.labelOff;
        btn.classList.toggle('active', on);
      };
      btn.addEventListener('click', () => {
        obj.setParam(item.param, !obj.params[item.param]);
        syncLabel();
      });
      syncLabel();
      row.appendChild(btn);
      refreshers.push(syncLabel);
    } else if (item.type === 'buttonRow') {
      const group = document.createElement('div'); group.className = 'insp-btn-row';
      for (const buttonDef of item.buttons) {
        const btn = document.createElement('button');
        btn.textContent = buttonDef.label;
        btn.addEventListener('click', buttonDef.action);
        group.appendChild(btn);
      }
      row.appendChild(group);
    } else if (item.type === 'readout') {
      const label = document.createElement('label');
      const name = document.createElement('span'); name.textContent = item.label;
      const val = document.createElement('span'); val.className = 'insp-readout';
      val.textContent = item.get();
      label.appendChild(name); label.appendChild(val);
      row.appendChild(label);
      refreshers.push(() => { val.textContent = item.get(); });
    } else if (item.type === 'opcuaBinding') {
      const label = document.createElement('label');
      const nameEl = document.createElement('span');
      nameEl.textContent = `OPC UA 태그 (${item.direction === 'read' ? 'PLC→sim' : 'sim→PLC'})`;
      label.appendChild(nameEl);
      const select = document.createElement('select');
      select.className = 'insp-opcua-select';

      const rebuildOptions = () => {
        const prev = select.value;
        select.innerHTML = '';
        const none = document.createElement('option');
        none.value = ''; none.textContent = '— 없음 —';
        select.appendChild(none);
        if (opcuaClient) {
          for (const tag of opcuaClient.getCatalogFor(item.direction)) {
            const opt = document.createElement('option');
            opt.value = tag.name; opt.textContent = tag.label;
            select.appendChild(opt);
          }
        }
        select.value = obj.opcua.tag ?? prev ?? '';
      };
      rebuildOptions();

      select.addEventListener('change', (event) => {
        const tag = event.target.value || null;
        obj.opcua.tag = tag;
        obj.opcua.direction = tag ? item.direction : null;
        obj.opcua.paramName = tag ? item.paramName : obj.opcua.paramName;
        obj._lastSentOpcua = undefined;
        if (tag && item.direction === 'read' && opcuaClient) {
          const value = opcuaClient.state[tag];
          if (value !== undefined) obj.setParam(item.paramName, !!value);
        }
      });

      row.appendChild(label); row.appendChild(select);

      if (opcuaClient) {
        const onCatalog = () => rebuildOptions();
        opcuaClient.addEventListener('catalog', onCatalog);
        cleanups.push(() => opcuaClient.removeEventListener('catalog', onCatalog));
      }
    }

    body.appendChild(row);
  }

  return { refreshers, cleanups };
}
