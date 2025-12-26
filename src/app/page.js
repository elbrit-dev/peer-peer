'use client';

// v2 - Fixed multi-selection and hierarchy logic
import { useEffect, useState } from "react";
import { useCollaboration } from "@/lib/collaboration";
import Link from "next/link";

export default function Home() {
  // Use the scoped collaboration hook which now manages selection internally
  const { 
    data, 
    availableMonths,
    availableTeams, 
    availableHqs, 
    selection,
    status, 
    peers, 
    actions 
  } = useCollaboration();

  const { month: selectedMonth, team: selectedTeam, hq: selectedHq } = selection;

  // Get all unique keys from data for dynamic columns
  const [columns, setColumns] = useState([]);

  useEffect(() => {
    if (data.length > 0) {
      // Get all unique keys present in the data to define columns
      const allKeys = new Set();
      data.forEach(item => {
        Object.keys(item).forEach(key => allKeys.add(key));
      });
      
      // Sort keys: put team, hq, customer, item_name first
      const preferredOrder = ['team', 'hq', 'customer', 'item_name', 'qty', 'value', 'posting_date'];
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
    if (!selectedTeam || !selectedHq) {
      alert("Please select exactly one Team and one HQ to add data.");
      return;
    }
    
    const formData = new FormData(e.target);
    const newItem = {
      customer: formData.get('customer'),
      item_name: formData.get('item_name'),
      qty: parseInt(formData.get('qty') || 0),
      value: parseFloat(formData.get('value') || 0),
      invoice_no: `INV-${Math.floor(Math.random() * 10000)}`,
      posting_date: new Date().toISOString().split('T')[0],
      sales_team: selectedTeam,
      hq: selectedHq
    };

    actions.addRow(newItem);
    e.target.reset();
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 p-4 dark:bg-black sm:p-8">
      <main className="w-full max-w-5xl rounded-xl bg-white p-6 shadow-sm dark:bg-zinc-900 sm:p-8">
        {/* Header Section */}
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold">Inventory Hierarchy</h1>
            <div className="mt-1 flex gap-2 text-xs font-medium">
              <span className="text-blue-500">{selectedMonth}</span>
              <span className="text-zinc-400">/</span>
              <span className="text-purple-500">
                {selectedTeam || "Select Team"}
              </span>
              <span className="text-zinc-400">/</span>
              <span className="text-green-500">
                {selectedHq || "Select HQ"}
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

        {/* Level 1: Month Selector (Rooms) */}
        <div className="mb-6">
          <label className="text-xs font-bold uppercase text-zinc-400">Select Room (Month)</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {availableMonths.length === 0 ? (
              <span className="text-sm text-zinc-400 italic border rounded-lg px-4 py-2 bg-zinc-50">
                Scanning database for rooms...
              </span>
            ) : (
              availableMonths.map(m => (
                <button
                  key={m}
                  onClick={() => actions.setMonth(m)}
                  className={`rounded-lg px-4 py-2 text-sm font-bold transition-all border ${
                    selectedMonth === m 
                      ? 'bg-blue-600 text-white border-blue-700 shadow-md transform scale-105' 
                      : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300'
                  }`}
                >
                  {new Date(m + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}
                  <span className="ml-2 opacity-50 text-[10px] font-normal tracking-tighter">({m})</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Sidebar: Hierarchy Controls */}
          <div className="md:col-span-1 space-y-6">
            {/* Level 2: Teams */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase text-zinc-400">Sales Teams</label>
                <span className="text-[10px] text-zinc-400 italic">Single Select</span>
              </div>
              <div className="flex flex-col gap-1">
                {availableTeams.map(t => (
                  <button key={t} onClick={() => actions.setTeam(t)}
                    className={`text-left rounded px-3 py-2 text-sm transition-all flex items-center gap-2 ${selectedTeam === t ? 'bg-purple-100 text-purple-700 font-bold border-l-4 border-purple-600' : 'hover:bg-zinc-50 text-zinc-600'}`}>
                    <input type="checkbox" checked={selectedTeam === t} readOnly className="pointer-events-none" />
                    {t}
                  </button>
                ))}
                <button onClick={() => actions.createTeam(prompt("Enter Team Name:"))} className="text-left text-xs text-blue-500 hover:underline px-3 mt-1">+ Create Team</button>
              </div>
            </div>

            {/* Level 3: HQs */}
            {selectedTeam && (
              <div>
                <label className="text-xs font-bold uppercase text-zinc-400">HQs (Sub-Rooms)</label>
                <div className="mt-2 flex flex-col gap-1">
                  {availableHqs.map(h => (
                    <button key={h} onClick={() => actions.setHq(h)}
                      className={`text-left rounded px-3 py-2 text-sm transition-all flex items-center gap-2 ${selectedHq === h ? 'bg-green-100 text-green-700 font-bold border-l-4 border-green-600' : 'hover:bg-zinc-50 text-zinc-600'}`}>
                      <input type="checkbox" checked={selectedHq === h} readOnly className="pointer-events-none" />
                      {h}
                    </button>
                  ))}
                  <button onClick={() => actions.createHq(prompt("Enter HQ Name:"))} className="text-left text-xs text-blue-500 hover:underline px-3 mt-1">+ Create HQ</button>
                </div>
              </div>
            )}
          </div>

          {/* Main Content: Data Table */}
          <div className="md:col-span-3">
            {/* Form to add new data */}
            <form onSubmit={addRow} className={`mb-6 grid grid-cols-1 gap-2 rounded-lg bg-zinc-50 p-4 sm:grid-cols-5 ${!selectedTeam || !selectedHq ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="sm:col-span-5 mb-2">
                <span className="text-xs font-bold text-zinc-400 uppercase">
                  {selectedTeam && selectedHq 
                    ? `Add data to ${selectedHq} (${selectedTeam})` 
                    : "Select 1 Team & 1 HQ to add data"}
                </span>
              </div>
              <input name="customer" placeholder="Customer" className="rounded border p-2 text-sm" required />
              <input name="item_name" placeholder="Item" className="rounded border p-2 text-sm" required />
              <input name="qty" type="number" placeholder="Qty" className="rounded border p-2 text-sm" required />
              <input name="value" type="number" step="0.01" placeholder="Val" className="rounded border p-2 text-sm" required />
              <button type="submit" className="rounded bg-blue-600 text-white text-xs font-bold uppercase hover:bg-blue-700">Add</button>
            </form>

            <div className="overflow-x-auto rounded-lg border border-zinc-200 shadow-sm">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-zinc-50 uppercase text-zinc-500 font-bold">
                  <tr>
                    {columns.map(col => (
                      <th key={col} className="px-3 py-2 whitespace-nowrap border-b border-zinc-200">{col.replace(/_/g, ' ')}</th>
                    ))}
                    <th className="px-3 py-2 text-center border-b border-zinc-200">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {!selectedTeam ? (
                    <tr><td colSpan={columns.length + 1} className="py-12 text-center text-zinc-400 italic">Please select a Sales Team to view data.</td></tr>
                  ) : !selectedHq ? (
                    <tr><td colSpan={columns.length + 1} className="py-12 text-center text-zinc-400 italic">Please select an HQ to view data.</td></tr>
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
          <p>● Hierarchy: {selectedMonth} &gt; {selectedTeam || '???'} &gt; {selectedHq || '???'}</p>
          <p>● Sync: Hybrid WebRTC + Firebase Cloud Relay (Scoped)</p>
          <p>● Persistence: IndexedDB Local Source</p>
        </div>
      </main>
    </div>
  );
}
