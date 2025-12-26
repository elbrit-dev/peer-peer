import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { doc, getDoc, getDocs, setDoc, collection, Bytes, arrayUnion } from 'firebase/firestore';
import { db } from './firebase';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

/**
 * Fetches the metadata for a month (e.g., list of teams)
 */
export const getMonthMetadata = async (month) => {
  if (!month) return { teams: [] };
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
  if (!month || !teamName) return [];
  const teamCollectionRef = collection(db, 'Primary', month, teamName);
  const snap = await getDocs(teamCollectionRef);
  return snap.docs.map(doc => doc.id).sort();
};

/**
 * Hook for Scoped Collaboration (Month -> Team -> HQ)
 * Uses a single Month-level P2P room with scoped Yjs arrays for each HQ.
 */
export const useCollaboration = () => {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [selectedHqs, setSelectedHqs] = useState([]);

  const [availableTeams, setAvailableTeams] = useState([]);
  const [availableHqs, setAvailableHqs] = useState([]);
  
  const [status, setStatus] = useState("Connecting...");
  const [peers, setPeers] = useState(0);
  
  const [ydoc, setYdoc] = useState(null);
  const [version, setVersion] = useState(0); // Used to trigger re-renders on Yjs changes
  
  const loadedHqsRef = useRef(new Set());

  // 1. Fetch available Teams for the selected month
  useEffect(() => {
    const fetchTeams = async () => {
      try {
        const monthData = await getMonthMetadata(selectedMonth);
        setAvailableTeams(monthData.teams || []);
      } catch (e) {
        console.error("Error fetching teams:", e);
      }
    };
    fetchTeams();
  }, [selectedMonth]);

  // 2. Fetch available HQs when teams are selected
  useEffect(() => {
    const fetchHqs = async () => {
      if (selectedTeams.length === 0) {
        setAvailableHqs([]);
        return;
      }
      
      try {
        const allHqs = [];
        for (const team of selectedTeams) {
          const hqs = await getTeamHqs(selectedMonth, team);
          allHqs.push(...hqs.map(h => ({ team, name: h })));
        }
        setAvailableHqs(allHqs);
      } catch (e) {
        console.error("Error fetching HQs:", e);
      }
    };
    fetchHqs();
  }, [selectedMonth, selectedTeams]);

  // 3. Initialize Month-Level Room (WebRTC + Persistence)
  useEffect(() => {
    if (!selectedMonth) return;

    const docInstance = new Y.Doc();
    const roomName = `Primary-${selectedMonth}`;

    const persistence = new IndexeddbPersistence(roomName, docInstance);
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

    // Observe all changes to trigger re-renders
    const handleUpdate = () => {
      setVersion(v => v + 1);
    };
    docInstance.on('update', handleUpdate);

    setYdoc(docInstance);
    loadedHqsRef.current = new Set();

    provider.awareness.on('change', () => {
      setPeers(provider.awareness.getStates().size);
    });

    provider.on('status', (event) => {
      setStatus(event.status === 'connected' ? `Online: ${selectedMonth}` : 'Connecting...');
    });

    return () => {
      docInstance.off('update', handleUpdate);
      provider.destroy();
      persistence.destroy();
      docInstance.destroy();
      setYdoc(null);
    };
  }, [selectedMonth]);

  // 4. Load Data from Firebase for selected HQs
  // If multiple teams selected, we load ALL HQs for those teams
  useEffect(() => {
    if (!ydoc) return;
    
    const hqsToLoad = selectedTeams.length > 1 
      ? availableHqs 
      : selectedHqs;

    if (hqsToLoad.length === 0) return;

    const loadMissingHqs = async () => {
      for (const hqObj of hqsToLoad) {
        const hqKey = `${hqObj.team}/${hqObj.name}`;
        if (!loadedHqsRef.current.has(hqKey)) {
          const hqRef = doc(db, 'Primary', selectedMonth, hqObj.team, hqObj.name);
          const snap = await getDoc(hqRef);
          
          if (snap.exists()) {
            const hqData = snap.data();
            if (hqData.hqUpdate) {
              try {
                const tempDoc = new Y.Doc();
                Y.applyUpdate(tempDoc, hqData.hqUpdate.toUint8Array());
                const incomingData = tempDoc.getArray('data').toArray();
                
                const scopedArray = ydoc.getArray(`data/${hqKey}`);
                if (scopedArray.length === 0 && incomingData.length > 0) {
                  ydoc.transact(() => {
                    scopedArray.push(incomingData);
                  }, 'internal-import');
                }
                
                loadedHqsRef.current.add(hqKey);
                setVersion(v => v + 1);
              } catch (err) {
                console.error(`Error importing ${hqKey}:`, err);
              }
            }
          } else {
             loadedHqsRef.current.add(hqKey);
          }
        }
      }
    };

    loadMissingHqs();
  }, [ydoc, selectedHqs, selectedTeams, availableHqs, selectedMonth]);

  // Actions
  const addRow = useCallback((newItem) => {
    if (!ydoc) return;
    const hqKey = `${newItem.sales_team}/${newItem.hq}`;
    const scopedArray = ydoc.getArray(`data/${hqKey}`);
    scopedArray.push([newItem]);
    
    const saveHq = async () => {
      const tempDoc = new Y.Doc();
      tempDoc.getArray('data').push(scopedArray.toArray());
      const state = Y.encodeStateAsUpdate(tempDoc);
      const hqRef = doc(db, 'Primary', selectedMonth, newItem.sales_team, newItem.hq);
      await setDoc(hqRef, {
        hq: newItem.hq,
        sales_team: newItem.sales_team,
        hqUpdate: Bytes.fromUint8Array(state),
        last_updated: new Date().toISOString()
      }, { merge: true });
    };
    saveHq();
  }, [ydoc, selectedMonth]);

  const deleteRow = useCallback((item) => {
    if (!ydoc) return;
    const hqKey = `${item.sales_team}/${item.hq}`;
    const scopedArray = ydoc.getArray(`data/${hqKey}`);
    const arrayData = scopedArray.toArray();
    const index = arrayData.findIndex(i => i.invoice_no === item.invoice_no);
    if (index > -1) {
      scopedArray.delete(index, 1);
      
      const saveHq = async () => {
        const tempDoc = new Y.Doc();
        tempDoc.getArray('data').push(scopedArray.toArray());
        const state = Y.encodeStateAsUpdate(tempDoc);
        const hqRef = doc(db, 'Primary', selectedMonth, item.sales_team, item.hq);
        await setDoc(hqRef, {
          hq: item.hq,
          sales_team: item.sales_team,
          hqUpdate: Bytes.fromUint8Array(state),
          last_updated: new Date().toISOString()
        }, { merge: true });
      };
      saveHq();
    }
  }, [ydoc, selectedMonth]);

  const toggleTeam = useCallback((teamName) => {
    setSelectedTeams(prev => {
      const isRemoving = prev.includes(teamName);
      let next;
      if (isRemoving) {
        next = prev.filter(t => t !== teamName);
      } else {
        next = [...prev, teamName];
      }

      // Requirement: When multi team select, hq select disabled and all hqs selected.
      // We'll clear selectedHqs if multiple teams are selected to signify "all"
      if (next.length > 1) {
        setSelectedHqs([]);
      } else if (isRemoving && next.length === 1) {
        // If we went from 2 to 1 team, we keep the 1 team but might want to reset HQs
        setSelectedHqs([]);
      }
      
      return next;
    });
  }, []);

  const toggleHq = useCallback((hqObj) => {
    // Disable HQ selection if multiple teams are selected
    if (selectedTeams.length > 1) return;

    setSelectedHqs(prev => {
      const exists = prev.find(h => h.name === hqObj.name && h.team === hqObj.team);
      if (exists) {
        return prev.filter(h => !(h.name === hqObj.name && h.team === hqObj.team));
      } else {
        return [...prev, hqObj];
      }
    });
  }, [selectedTeams]);

  const selectAllHqs = useCallback(() => {
    if (selectedTeams.length !== 1) return;
    setSelectedHqs(availableHqs);
  }, [selectedTeams, availableHqs]);

  const deselectAllHqs = useCallback(() => {
    setSelectedHqs([]);
  }, []);

  // Filtered data for the UI
  const filteredData = useMemo(() => {
    if (!ydoc || selectedTeams.length === 0) return [];
    
    let result = [];
    
    for (const team of selectedTeams) {
      // If multiple teams or no specific HQs selected, show all available for this team
      const teamHqs = selectedHqs.filter(h => h.team === team);
      const useAll = selectedTeams.length > 1 || teamHqs.length === 0;
      
      if (useAll) {
        const hqsForTeam = availableHqs.filter(h => h.team === team);
        for (const hq of hqsForTeam) {
          const hqKey = `${hq.team}/${hq.name}`;
          const arr = ydoc.getArray(`data/${hqKey}`);
          result.push(...arr.toArray());
        }
      } else {
        for (const hq of teamHqs) {
          const hqKey = `${hq.team}/${hq.name}`;
          const arr = ydoc.getArray(`data/${hqKey}`);
          result.push(...arr.toArray());
        }
      }
    }
    
    return result;
  }, [ydoc, version, selectedTeams, selectedHqs, availableHqs]);

  return {
    data: filteredData,
    availableTeams,
    availableHqs,
    selection: {
      month: selectedMonth,
      teams: selectedTeams,
      hqs: selectedHqs
    },
    status,
    peers,
    actions: {
      setMonth: (m) => { 
        setSelectedMonth(m); 
        setSelectedTeams([]); 
        setSelectedHqs([]); 
        loadedHqsRef.current.clear();
      },
      toggleTeam,
      toggleHq,
      selectAllHqs,
      deselectAllHqs,
      addRow,
      deleteRow,
      createTeam: async (name) => {
        if (!name) return;
        const monthRef = doc(db, 'Primary', selectedMonth);
        await setDoc(monthRef, { teams: arrayUnion(name) }, { merge: true });
        setAvailableTeams(prev => [...new Set([...prev, name])]);
      },
      createHq: async (team, name) => {
        if (!team || !name) return;
        const hqRef = doc(db, 'Primary', selectedMonth, team, name);
        const tempDoc = new Y.Doc();
        const initData = [{
          customer: "System",
          item_name: `HQ ${name} created`,
          qty: 0,
          value: 0,
          invoice_no: `INIT-HQ-${Date.now()}`,
          posting_date: new Date().toISOString().split('T')[0],
          sales_team: team,
          hq: name
        }];
        tempDoc.getArray('data').push(initData);
        const state = Y.encodeStateAsUpdate(tempDoc);
        await setDoc(hqRef, {
          hq: name,
          sales_team: team,
          hqUpdate: Bytes.fromUint8Array(state),
          last_updated: new Date().toISOString()
        });
        
        if (ydoc) {
          const hqKey = `${team}/${name}`;
          const scopedArray = ydoc.getArray(`data/${hqKey}`);
          scopedArray.push(initData);
        }
        
        setAvailableHqs(prev => [...prev, { team, name }]);
        tempDoc.destroy();
      }
    }
  };
};
