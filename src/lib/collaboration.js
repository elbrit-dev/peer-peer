import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { doc, getDoc, getDocs, setDoc, collection, Bytes, onSnapshot, deleteField, arrayUnion } from 'firebase/firestore';
import { db } from './firebase';
import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Fetches the metadata for a month (e.g., list of teams)
 */
export const getMonthMetadata = async (month) => {
  const monthRef = doc(db, 'Primary', month);
  const snap = await getDoc(monthRef);
  if (snap.exists()) {
    return snap.data();
  }
  return { teams: [] };
};

/**
 * Fetches the list of HQs for a specific team in a month
 */
export const getTeamHqs = async (month, teamName) => {
  if (!teamName) return [];
  const teamCollectionRef = collection(db, 'Primary', month, teamName);
  const snap = await getDocs(teamCollectionRef);
  return snap.docs.map(doc => doc.id).sort();
};

/**
 * Fetches all available months from the Primary collection
 */
export const getAvailableMonths = async () => {
  try {
    const primaryRef = collection(db, 'Primary');
    const snap = await getDocs(primaryRef);
    return snap.docs
      .map(doc => doc.id)
      .filter(id => /^\d{4}-\d{2}$/.test(id))
      .sort()
      .reverse();
  } catch (e) {
    console.error("Error fetching available months:", e);
    return [];
  }
};

/**
 * Hook for Scoped Collaboration (Month -> Team -> HQ)
 * Manages selection internally to simplify UI components.
 */
export const useCollaboration = () => {
  // 1. Internal Selection State
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedHq, setSelectedHq] = useState(null);

  const [data, setData] = useState([]);
  const [availableMonths, setAvailableMonths] = useState([]);
  const [availableTeams, setAvailableTeams] = useState([]);
  const [availableHqs, setAvailableHqs] = useState([]);
  const [status, setStatus] = useState("Connecting...");
  const [peers, setPeers] = useState(0);
  const [ydoc, setYdoc] = useState(null);

  // 0. Discover available Months and their metadata dynamically in real-time
  const [monthsMetadata, setMonthsMetadata] = useState({});

  useEffect(() => {
    console.log("[collaboration] Initializing real-time month discovery...");
    const primaryRef = collection(db, 'Primary');
    
    const unsub = onSnapshot(primaryRef, (snap) => {
      const metadata = {};
      const discoveredMonths = snap.docs
        .filter(doc => /^\d{4}-\d{2}$/.test(doc.id))
        .map(doc => {
          const id = doc.id;
          const data = doc.data();
          metadata[id] = data;
          return id;
        })
        .sort()
        .reverse();
      
      console.log("[collaboration] Discovered months from Firestore:", discoveredMonths);
      setAvailableMonths(discoveredMonths);
      setMonthsMetadata(metadata);
      
      // Auto-select latest month if none selected
      if (discoveredMonths.length > 0 && !selectedMonth) {
        setSelectedMonth(discoveredMonths[0]);
      }
    }, (err) => {
      console.error("[collaboration] Month discovery error:", err);
    });

    return () => unsub();
  }, []);

  // 1. Update available teams when selected month or metadata changes
  useEffect(() => {
    if (!selectedMonth) {
      setAvailableTeams([]);
      return;
    }
    const teams = monthsMetadata[selectedMonth]?.teams || [];
    console.log(`[collaboration] Updating available teams for ${selectedMonth}:`, teams);
    setAvailableTeams(teams);
  }, [selectedMonth, monthsMetadata]);

  // 2. Fetch available HQs when a single Team is selected
  const refreshHqs = useCallback(async () => {
    if (!selectedTeam) {
      setAvailableHqs([]);
      return;
    }
    try {
      const hqs = await getTeamHqs(selectedMonth, selectedTeam);
      setAvailableHqs(hqs);

      // Auto-select first HQ if none selected
      if (hqs.length > 0 && !selectedHq) {
        // setSelectedHq(hqs[0]);
      }
    } catch (e) {
      console.error("Error fetching HQs:", e);
    }
  }, [selectedMonth, selectedTeam, selectedHq]);

  useEffect(() => {
    refreshHqs();
  }, [refreshHqs]);

  // 3. Initialize Scoped Sync (WebRTC + Firestore)
  useEffect(() => {
    if (!selectedMonth) {
      setData([]);
      setYdoc(null);
      setStatus("Select Month");
      return;
    }

    let cleanup;
    const setup = async () => {
      const docInstance = new Y.Doc();
      
      // 1. Determine Scope
      const scope = selectedHq ? 'hq' : (selectedTeam ? 'team' : 'month');
      
      let roomName;
      if (scope === 'hq') roomName = `${selectedMonth}-${selectedTeam}-${selectedHq}`;
      else if (scope === 'team') roomName = `${selectedMonth}-${selectedTeam}`;
      else roomName = selectedMonth;

      console.log(`[collaboration] Connecting to ${scope.toUpperCase()} scope: ${roomName}`);

      // 2. Local Persistence
      const persistence = new IndexeddbPersistence(roomName, docInstance);

      // 3. P2P Sync
      const provider = new WebrtcProvider(roomName, docInstance, {
        signaling: ['ws://localhost:4444'],
        peerOpts: {
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        }
      });

      // 4. Firebase Sync (Initial Load & Real-time Listen)
      let isInitialLoad = true;
      let unsub;

      try {
        if (scope === 'hq') {
          // HQ Scope: Single Document
          const hqRef = doc(db, 'Primary', selectedMonth, selectedTeam, selectedHq);
          const snap = await getDoc(hqRef);
          if (snap.exists() && snap.data().hqUpdate) {
            Y.applyUpdate(docInstance, snap.data().hqUpdate.toUint8Array());
          }
          unsub = onSnapshot(hqRef, (snapshot) => {
            if (isInitialLoad) return;
            const snapData = snapshot.data();
            if (snapData?.hqUpdate) {
              try {
                Y.applyUpdate(docInstance, snapData.hqUpdate.toUint8Array(), 'cloud-relay');
              } catch (e) { console.error('Relay error:', e); }
            }
          });
        } else if (scope === 'team') {
          // Team Scope: Aggregate all HQ documents in the Team collection
          const teamColRef = collection(db, 'Primary', selectedMonth, selectedTeam);
          const snap = await getDocs(teamColRef);
          snap.docs.forEach(d => {
            const update = d.data().hqUpdate;
            if (update) Y.applyUpdate(docInstance, update.toUint8Array());
          });
          unsub = onSnapshot(teamColRef, (snapshot) => {
            if (isInitialLoad) return;
            snapshot.docChanges().forEach(change => {
              if (change.type === 'added' || change.type === 'modified') {
                const update = change.doc.data().hqUpdate;
                if (update) {
                  try {
                    Y.applyUpdate(docInstance, update.toUint8Array(), 'cloud-relay');
                  } catch (e) { console.error('Relay error:', e); }
                }
              }
            });
          });
        } else {
          // Month Scope: Single Summary Document
          const monthRef = doc(db, 'Primary', selectedMonth);
          const snap = await getDoc(monthRef);
          if (snap.exists() && snap.data().ydocState) {
            Y.applyUpdate(docInstance, snap.data().ydocState.toUint8Array());
          }
          unsub = onSnapshot(monthRef, (snapshot) => {
            if (isInitialLoad) return;
            const snapData = snapshot.data();
            if (snapData?.ydocState) {
              try {
                Y.applyUpdate(docInstance, snapData.ydocState.toUint8Array(), 'cloud-relay');
              } catch (e) { console.error('Relay error:', e); }
            }
          });
        }
      } catch (err) {
        console.error(`[collaboration] Firebase ${scope} sync error:`, err);
      } finally {
        isInitialLoad = false;
      }

      // 5. Data Handling
      const yarray = docInstance.getArray('data');
      const syncData = () => {
        const rawData = yarray.toArray();
        // Flatten and deduplicate by invoice_no if necessary
        const flattened = rawData.flat();
        setData(flattened);
      };
      yarray.observe(syncData);
      syncData();

      setYdoc(docInstance);

      // 6. Presence & Status
      provider.awareness.on('change', () => {
        setPeers(provider.awareness.getStates().size);
      });

      provider.on('status', (event) => {
        const label = scope === 'hq' ? selectedHq : (scope === 'team' ? selectedTeam : selectedMonth);
        setStatus(event.status === 'connected' ? `Online: ${label}` : 'Connecting...');
      });

      // 7. Cloud Relay Save (Only in HQ Scope to prevent master data corruption)
      docInstance.on('update', (update, origin) => {
        if (isInitialLoad || origin === 'cloud-relay' || scope !== 'hq') return;
        
        const saveToCloud = async () => {
          const state = Y.encodeStateAsUpdate(docInstance);
          try {
            const hqRef = doc(db, 'Primary', selectedMonth, selectedTeam, selectedHq);
            await setDoc(hqRef, {
              hq: selectedHq,
              sales_team: selectedTeam,
              hqUpdate: Bytes.fromUint8Array(state),
              last_updated: new Date().toISOString()
            }, { merge: true });

            // Month metadata heartbeat
            await setDoc(doc(db, 'Primary', selectedMonth), {
              last_updated: new Date().toISOString()
            }, { merge: true });
          } catch (e) {
            console.error('Cloud save error:', e);
          }
        };
        saveToCloud();
      });

      cleanup = () => {
        yarray.unobserve(syncData);
        if (unsub) unsub();
        provider.destroy();
        persistence.destroy();
        docInstance.destroy();
      };
    };

    setup();
    return () => { if (cleanup) cleanup(); };
  }, [selectedMonth, selectedTeam, selectedHq]);

  // Actions
  const addRow = useCallback((newItem) => {
    if (!ydoc) return;
    ydoc.getArray('data').push([newItem]);
  }, [ydoc]);

  const deleteRow = useCallback((item) => {
    if (!ydoc) return;
    const yarray = ydoc.getArray('data');
    const arrayData = yarray.toArray();
    const index = arrayData.findIndex(i => i.invoice_no === item.invoice_no);
    if (index > -1) yarray.delete(index, 1);
  }, [ydoc]);

  const createTeam = useCallback(async (name) => {
    if (!name) return;
    try {
      const monthRef = doc(db, 'Primary', selectedMonth);
      await setDoc(monthRef, { teams: arrayUnion(name) }, { merge: true });
      await refreshTeams();
    } catch (e) {
      console.error("Error creating team:", e);
    }
  }, [selectedMonth, refreshTeams]);

  const createHq = useCallback(async (name) => {
    if (!selectedTeam || !name) return;
    const hqRef = doc(db, 'Primary', selectedMonth, selectedTeam, name);
    
    // Scoped initialization for HQ creation
    const tempDoc = new Y.Doc();
    tempDoc.getArray('data').push([{
      customer: "System",
      item_name: `HQ ${name} created`,
      qty: 0,
      value: 0,
      invoice_no: `INIT-HQ-${Date.now()}`,
      posting_date: new Date().toISOString().split('T')[0],
      sales_team: selectedTeam,
      hq: name
    }]);

    const state = Y.encodeStateAsUpdate(tempDoc);
    await setDoc(hqRef, {
      hq: name,
      sales_team: selectedTeam,
      hqUpdate: Bytes.fromUint8Array(state),
      last_updated: new Date().toISOString()
    });

    await refreshHqs();
    tempDoc.destroy();
  }, [selectedMonth, selectedTeam, refreshHqs]);

  return {
    data,
    availableMonths,
    availableTeams,
    availableHqs,
    selection: {
      month: selectedMonth,
      team: selectedTeam,
      hq: selectedHq
    },
    status,
    peers,
    actions: {
      setMonth: (m) => { setSelectedMonth(m); setSelectedTeam(null); setSelectedHq(null); },
      setTeam: (t) => { setSelectedTeam(t); setSelectedHq(null); },
      setHq: (h) => { setSelectedHq(h); },
      addRow,
      deleteRow,
      createTeam,
      createHq
    }
  };
};
