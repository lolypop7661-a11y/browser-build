import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSpringPresence } from './motion.js';
import { extensionById, extensionCatalog, extensionCategories, siteOf } from './extensions/catalog.js';
import { extensionTools } from './extensions/tools.jsx';

const isAutomatic = extension => Boolean(extension.onPageReady || extension.checkNavigation || extension.onZoom);

/** The Extensions drawer: installed tools, the tool view, and the store. */
export function ExtensionsDrawer({ open, onClose, host, activeTab, onNotice, onOpenTab, Icon, Button, CloseButton }) {
  const state = useSyncExternalStore(host.subscribe, host.getState);
  const [view, setView] = useState('mine');
  const [toolId, setToolId] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [hidden, setHidden] = useState(false);
  const installed = extensionCatalog.filter(extension => state.installed[extension.id]);
  const tool = toolId && state.installed[toolId] ? extensionById.get(toolId) : null;
  const visible = open && !hidden;
  const panelRef = useSpringPresence(visible, { preset: 'fluid', offset: 90 });

  useEffect(() => { if (open && !installed.length) setView('store'); }, [open]);
  useEffect(() => { if (toolId && !state.installed[toolId]) setToolId(null); }, [state.installed, toolId]);

  const ctx = useMemo(() => ({
    host, url: activeTab?.url || '', title: activeTab?.title || '', site: siteOf(activeTab?.url || ''), tabId: activeTab?.id,
    notify: onNotice, openTab: onOpenTab, setDrawerHidden: setHidden,
  }), [host, activeTab?.url, activeTab?.title, activeTab?.id, onNotice, onOpenTab]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return extensionCatalog.filter(extension => (category === 'All' || extension.category === category)
      && (!needle || `${extension.name} ${extension.description} ${extension.category}`.toLowerCase().includes(needle)));
  }, [query, category]);

  const install = extension => { host.install(extension.id); onNotice?.(`${extension.name} installed`); setToolId(extension.id); };
  const remove = extension => { host.uninstall(extension.id); onNotice?.(`${extension.name} removed`); };
  const Tool = tool ? extensionTools[tool.id] : null;

  return <aside ref={panelRef} className={`drawer extensions-drawer ${visible ? 'open' : ''} ${tool?.wide ? 'is-wide' : ''}`} aria-hidden={!visible} aria-label="Browsery extensions">
    <div className="drawer-head ext-head">
      {tool ? <div className="ext-title">
        <button type="button" className="ext-back" onClick={() => setToolId(null)} aria-label="Back to extensions"><Icon name="back" size={16} /></button>
        <span className="ext-glyph"><Icon name={tool.icon} size={17} /></span>
        <div><span className="drawer-kicker">{tool.category}{isAutomatic(tool) ? ' · works automatically' : ''}</span><h2>{tool.name}</h2></div>
      </div> : <div><h2>Extensions</h2></div>}
      <CloseButton icon="close" label="Close extensions" onClick={onClose} />
    </div>

    {tool ? <div className="ext-body ext-tool" key={tool.id}>
      {Tool && <Tool ctx={ctx} config={state.configs[tool.id]} setConfig={update => host.setConfig(tool.id, update)} hostState={state} Icon={Icon} Button={Button} />}
      <div className="ext-tool-footer"><p>{tool.description}</p><button type="button" className="ext-remove" onClick={() => remove(tool)}>Remove {tool.name}</button></div>
    </div> : <>
      <nav className="ext-tabs" aria-label="Extension views">
        <button type="button" className={view === 'mine' ? 'active' : ''} aria-pressed={view === 'mine'} onClick={() => setView('mine')}>Your extensions <em>{installed.length}</em></button>
        <button type="button" className={view === 'store' ? 'active' : ''} aria-pressed={view === 'store'} onClick={() => setView('store')}>Store <em>{extensionCatalog.length}</em></button>
      </nav>
      {view === 'mine' ? <div className="ext-body">
        {installed.length ? <div className="ext-tiles">{installed.map(extension => <button type="button" key={extension.id} className="ext-tile" onClick={() => setToolId(extension.id)}>
          <span className="ext-glyph"><Icon name={extension.icon} size={18} /></span>
          <b>{extension.name}</b>
          <small>{isAutomatic(extension) ? 'Automatic' : 'Tool'}{extension.id === 'auto-refresh' && Object.keys(state.refresh).length ? ` · ${Object.keys(state.refresh).length} running` : ''}{extension.id === 'focus-mode' && state.configs['focus-mode'].endsAt > Date.now() ? ' · focusing' : ''}</small>
        </button>)}</div> : <div className="ext-empty"><Icon name="extension" size={26} /><b>No extensions yet</b><span>Add tools like Reader View, Night Shift and Focus Mode from the store.</span><Button onClick={() => setView('store')}>Browse the store</Button></div>}
      </div> : <div className="ext-body">
        <label className="ext-search"><Icon name="search" size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search extensions" aria-label="Search extensions" /></label>
        <div className="ext-categories" role="group" aria-label="Categories">{extensionCategories.map(name => <button type="button" key={name} className={category === name ? 'active' : ''} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
        {results.length ? <div className="ext-cards">{results.map(extension => {
          const has = Boolean(state.installed[extension.id]);
          return <article key={extension.id} className={`ext-card ${has ? 'installed' : ''}`}>
            <div className="ext-card-head"><span className="ext-glyph"><Icon name={extension.icon} size={17} /></span><div><span>{extension.category}</span><h3>{extension.name}</h3></div></div>
            <p>{extension.description}</p>
            <div className="ext-card-actions">{has ? <><Button onClick={() => setToolId(extension.id)}>Open</Button><button type="button" className="ext-remove" onClick={() => remove(extension)}>Remove</button></> : <Button className="ext-install" onClick={() => install(extension)}>Add</Button>}</div>
          </article>;
        })}</div> : <div className="ext-empty"><b>No matches</b><span>Try another word or category.</span></div>}
      </div>}
    </>}
  </aside>;
}
