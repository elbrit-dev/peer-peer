'use client';

// v4 - Refined multi-selection behavior
import { useEffect, useState } from "react";
import { useCollaboration } from "@/lib/collaboration";
import Link from "next/link";

export default function Home() {
  const { 
    data, 
    availableTeams, 
    availableHqs, 
    selection,
    status, 
    peers, 
    actions 
  } = useCollaboration();

  const { month: selectedMonth, teams: selectedTeams, hqs: selectedHqs } = selection;

  const [columns, setColumns] = useState([]);

  useEffect(() => {
    if (data.length > 0) {
      const allKeys = new Set();
      data.forEach(item => {
        Object.keys(item).forEach(key => allKeys.add(key));
      });
      
      const preferredOrder = ['sales_team', 'hq', 'customer', 'item_name', 'qty', 'value', 'posting_date'];
      const sortedKeys = Array.from(allKeys).sort((a, b) => {
        const indexA = preferredOrder.indexOf(a);
        const indexB = preferredOrder.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
      });
      setColumns(sortedKeys);
    }
  }, [data]);

  const addRow = (e) => {
    e.preventDefault();
    // Add row only works when exactly one HQ is selected (or conceptually active)
    // When multi-team, selectedHqs is empty (meaning all), so we shouldn't allow addRow unless specifically handled.
    if (selectedTeams.length !== 1 || (selectedHqs.length !== 1 && availableHqs.length !== 1)) {
      alert("Please select exactly one HQ to add data. (Ensure only one team and one HQ are active)");
      return;
    }
    
    const targetHq = selectedHqs.length === 1 ? selectedHqs[0] : availableHqs[0];
    const formData = new FormData(e.target);
    const newItem = {
      customer: formData.get('customer'),
      item_name: formData.get('item_name'),
      qty: parseInt(formData.get('qty') || 0),
      value: parseFloat(formData.get('value') || 0),
      invoice_no: `INV-${Math.floor(Math.random() * 10000)}`,
      posting_date: new Date().toISOString().split('T')[0],
      sales_team: targetHq.team,
      hq: targetHq.name
    };

    actions.addRow(newItem);
    e.target.reset();
  };

  const isMultiTeam = selectedTeams.length > 1;

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 p-4 dark:bg-black sm:p-8">
      <main className="w-full max-w-6xl rounded-xl bg-white p-6 shadow-sm dark:bg-zinc-900 sm:p-8">
        {/* Header Section */}
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold">Inventory Collaboration</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-medium">
              <span className="text-blue-500">{selectedMonth}</span>
              <span className="text-zinc-400">/</span>
              <span className="text-purple-500">
                {selectedTeams.length > 0 ? selectedTeams.join(', ') : "Select Teams"}
              </span>
              <span className="text-zinc-400">/</span>
              <span className="text-green-500">
                {isMultiTeam ? "All HQs Selected" : selectedHqs.length > 0 ? selectedHqs.map(h => h.name).join(', ') : "All HQs"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link 
              href="/seed"
              className="rounded bg-zinc-100 px-3 py-1 text-xs font-bold uppercase text-zinc-600 hover:bg-zinc-200"
            >
              Seed Admin
            </Link>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm font-medium">{peers} Peers</span>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${status.includes('Online') ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
              {status}
            </span>
          </div>
        </div>

        {/* Level 1: Month Selector */}
        <div className="mb-6">
          <label className="text-xs font-bold uppercase text-zinc-400">Select Month (P2P Room)</label>
          <div className="mt-2 flex items-center gap-3">
            <input 
              type="month" 
              value={selectedMonth} 
              onChange={(e) => actions.setMonth(e.target.value)}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium shadow-sm focus:border-blue-500 focus:outline-none dark:bg-zinc-800 dark:border-zinc-700"
            />
            <span className="text-xs text-zinc-400 italic">Connected to {selectedMonth} collaboration room</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Sidebar: Hierarchy Controls */}
          <div className="md:col-span-1 space-y-6">
            {/* Level 2: Teams */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase text-zinc-400">Sales Teams</label>
                <span className="text-[10px] text-zinc-400 italic">Multi-Select</span>
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-2">
                {availableTeams.map(t => (
                  <button key={t} onClick={() => actions.toggleTeam(t)}
                    className={`text-left rounded px-3 py-2 text-sm transition-all flex items-center gap-2 ${selectedTeams.includes(t) ? 'bg-purple-100 text-purple-700 font-bold border-l-4 border-purple-600' : 'hover:bg-zinc-50 text-zinc-600'}`}>
                    <input type="checkbox" checked={selectedTeams.includes(t)} onChange={() => {}} className="pointer-events-none" />
                    {t}
                  </button>
                ))}
                <button onClick={() => actions.createTeam(prompt("Enter Team Name:"))} className="text-left text-xs text-blue-500 hover:underline px-3 mt-1">+ Create Team</button>
              </div>
            </div>

            {/* Level 3: HQs */}
            {selectedTeams.length > 0 && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold uppercase text-zinc-400">HQs</label>
                  <div className="flex gap-2">
                    {!isMultiTeam && (
                      <button onClick={selectedHqs.length === availableHqs.length ? actions.deselectAllHqs : actions.selectAllHqs} 
                        className="text-[10px] text-blue-500 hover:underline">
                        {selectedHqs.length === availableHqs.length ? "Deselect All" : "Select All"}
                      </button>
                    )}
                    {isMultiTeam && <span className="text-[10px] text-zinc-400 italic">Multi-Team: All HQs Active</span>}
                  </div>
                </div>
                <div className={`flex flex-col gap-1 max-h-64 overflow-y-auto pr-2 ${isMultiTeam ? 'opacity-70' : ''}`}>
                  {availableHqs.map(h => {
                    const isSelected = isMultiTeam || !!selectedHqs.find(sh => sh.name === h.name && sh.team === h.team) || selectedHqs.length === 0;
                    return (
                      <button key={`${h.team}-${h.name}`} 
                        onClick={() => actions.toggleHq(h)}
                        disabled={isMultiTeam}
                        className={`text-left rounded px-3 py-2 text-sm transition-all flex items-center gap-2 ${isSelected ? 'bg-green-100 text-green-700 font-bold border-l-4 border-green-600' : 'hover:bg-zinc-50 text-zinc-600'} ${isMultiTeam ? 'cursor-default' : ''}`}>
                        <input type="checkbox" checked={isSelected} onChange={() => {}} className="pointer-events-none" />
                        <div className="flex flex-col">
                          <span>{h.name}</span>
                          {selectedTeams.length > 1 && <span className="text-[9px] opacity-60 uppercase">{h.team}</span>}
                        </div>
                      </button>
                    );
                  })}
                  {!isMultiTeam && (
                    <button onClick={() => {
                      const team = selectedTeams[0];
                      actions.createHq(team, prompt("Enter HQ Name:"));
                    }} className="text-left text-xs text-blue-500 hover:underline px-3 mt-1">+ Create HQ</button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Main Content: Data Table */}
          <div className="md:col-span-3">
            {/* Form to add new data */}
            <form onSubmit={addRow} className={`mb-6 grid grid-cols-1 gap-2 rounded-lg bg-zinc-50 p-4 sm:grid-cols-5 ${isMultiTeam || (selectedHqs.length !== 1 && availableHqs.length !== 1) ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="sm:col-span-5 mb-2">
                <span className="text-xs font-bold text-zinc-400 uppercase">
                  {!isMultiTeam && (selectedHqs.length === 1 || availableHqs.length === 1)
                    ? `Add data to ${(selectedHqs[0] || availableHqs[0]).name}` 
                    : "Select exactly 1 HQ to add data"}
                </span>
              </div>
              <input name="customer" placeholder="Customer" className="rounded border p-2 text-sm" required />
              <input name="item_name" placeholder="Item" className="rounded border p-2 text-sm" required />
              <input name="qty" type="number" placeholder="Qty" className="rounded border p-2 text-sm" required />
              <input name="value" type="number" step="0.01" placeholder="Val" className="rounded border p-2 text-sm" required />
              <button type="submit" className="rounded bg-blue-600 text-white text-xs font-bold uppercase hover:bg-blue-700">Add</button>
            </form>

            <div className="overflow-x-auto overflow-y-auto max-h-[600px] rounded-lg border border-zinc-200 shadow-sm">
              <table className="w-full text-left text-[10px] border-collapse">
                <thead className="bg-zinc-50 uppercase text-zinc-500 font-bold sticky top-0 z-10 shadow-sm">
                  <tr>
                    {columns.map(col => (
                      <th key={col} className="px-3 py-2 whitespace-nowrap border-b border-zinc-200 bg-zinc-50">{col.replace(/_/g, ' ')}</th>
                    ))}
                    <th className="px-3 py-2 text-center border-b border-zinc-200 bg-zinc-50">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {selectedTeams.length === 0 ? (
                    <tr><td colSpan={columns.length + 1} className="py-12 text-center text-zinc-400 italic">Please select Sales Teams to view data.</td></tr>
                  ) : data.length === 0 ? (
                    <tr><td colSpan={columns.length + 1} className="py-12 text-center text-zinc-400 italic">No data found in this selection.</td></tr>
                  ) : (
                    data.map((item, idx) => (
                      <tr key={`${item.invoice_no || 'no-inv'}-${idx}`} className="hover:bg-zinc-50 transition-colors">
                        {columns.map(col => (
                          <td key={col} className="px-3 py-2 whitespace-nowrap">
                            {typeof item[col] === 'number' 
                              ? (col.includes('value') || col.includes('amount') || col.includes('total'))
                                ? `₹${item[col].toLocaleString()}`
                                : item[col]
                              : String(item[col] ?? '')}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => actions.deleteRow(item)} className="text-red-500 hover:underline">Delete</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-zinc-100 flex flex-wrap gap-4 text-[10px] text-zinc-400 uppercase font-bold tracking-widest">
          <p>● Month Room: {selectedMonth}</p>
          <p>● Teams: {selectedTeams.length}</p>
          <p>● Active HQs: {isMultiTeam ? availableHqs.length : selectedHqs.length || availableHqs.length}</p>
          <p>● P2P: {peers} Peers Online</p>
        </div>
      </main>
    </div>
  );
}
