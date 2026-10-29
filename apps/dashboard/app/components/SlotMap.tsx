'use client';

import { useState } from 'react';
import type { LevelSlots } from '../lib/types';

export default function SlotMap({
  levels,
  onReopenSlot,
}: {
  levels: LevelSlots[];
  onReopenSlot?: (slotId: string, slotNumber: string) => void;
}) {
  const [selectedCode, setSelectedCode] = useState<string>('');
  const current = levels.find((l) => l.levelCode === selectedCode) || levels[0];

  return (
    <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-700 gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Slot Map</h2>
          <p className="text-xs text-slate-400">Live occupancy by level</p>
        </div>
        <div className="flex flex-wrap gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
          {levels.map((lvl) => (
            <button
              key={lvl.levelCode}
              onClick={() => setSelectedCode(lvl.levelCode)}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                current?.levelCode === lvl.levelCode ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              {lvl.displayName}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {current && current.slots.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-10 gap-3">
            {current.slots.map((slot) => {
              const isOccupied = slot.status === 'RESERVED_OCCUPIED';
              const style = !slot.isActive
                ? 'bg-slate-900 border-slate-700 text-slate-500'
                : isOccupied
                ? 'bg-rose-950/60 border-rose-700/80 text-rose-200'
                : 'bg-emerald-950/60 border-emerald-700/80 text-emerald-200';
              const content = (
                <>
                  <div className="text-xs font-bold">{slot.slotNumber}</div>
                  <div className="text-[10px] uppercase font-semibold mt-1">
                    {!slot.isActive ? 'Blocked' : isOccupied ? 'Occupied' : 'Open'}
                  </div>
                  {isOccupied && slot.currentSession?.vehicle?.licensePlate && (
                    <div className="text-[9px] font-mono text-rose-300 mt-1 truncate">
                      {slot.currentSession.vehicle.licensePlate}
                    </div>
                  )}
                </>
              );
              return !slot.isActive && onReopenSlot ? (
                <button
                  key={slot.id}
                  onClick={() => onReopenSlot(slot.id, slot.slotNumber)}
                  title="Click to reopen this slot once it is clear"
                  className={`p-3 rounded-lg border text-center hover:border-blue-500 ${style}`}
                >
                  {content}
                </button>
              ) : (
                <div key={slot.id} className={`p-3 rounded-lg border text-center ${style}`}>
                  {content}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-8">No slots configured on this level.</p>
        )}
        <p className="text-[11px] text-slate-500 mt-4">
          “Blocked” slots were flagged when a driver reported them obstructed and are skipped by automatic
          allocation. Click one to reopen it once it is clear.
        </p>
      </div>
    </section>
  );
}
