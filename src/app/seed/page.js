'use client';

import { useState } from "react";
import { seedDatabase } from "@/lib/seed";
import Link from "next/link";

export default function SeedPage() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeed = async () => {
    if (!selectedMonth) {
      alert("Please select a month first.");
      return;
    }

    setIsSeeding(true);
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      const startDate = `${selectedMonth}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
      
      console.log(`Triggering seed for: ${startDate} to ${endDate} into month ${selectedMonth}`);
      await seedDatabase(startDate, endDate, selectedMonth);
    } catch (err) {
      console.error("Error during seeding:", err);
      alert("Seeding failed. Check console for details.");
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 p-4 dark:bg-black sm:p-8">
      <main className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-sm dark:bg-zinc-900 sm:p-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Database Seeding</h1>
          <Link href="/" className="text-sm text-blue-500 hover:underline">
            &larr; Back to Dashboard
          </Link>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 text-sm text-orange-800">
            <p className="font-bold">Warning:</p>
            <p>Seeding will fetch live data from GraphQL and overwrite existing binary state for the selected month in Firestore. This action cannot be undone.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-zinc-400">Select Month to Seed</label>
            <div className="flex items-center gap-3">
              <input 
                type="month" 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium shadow-sm focus:border-blue-500 focus:outline-none dark:bg-zinc-800 dark:border-zinc-700"
              />
            </div>
          </div>

          <button 
            onClick={handleSeed}
            disabled={isSeeding}
            className={`w-full rounded-lg py-3 text-sm font-bold uppercase text-white transition-colors ${
              isSeeding 
                ? 'bg-zinc-400 cursor-not-allowed' 
                : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {isSeeding ? 'Seeding Database...' : 'Run Seeding Process'}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-zinc-100 space-y-2 text-xs text-zinc-500">
          <p>● Fetches: Sales Invoices & Targets</p>
          <p>● Source: ERP GraphQL API</p>
          <p>● Destination: Primary/[Month] Collection</p>
        </div>
      </main>
    </div>
  );
}

