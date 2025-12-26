import { db } from "./firebase";
import { doc, setDoc, Bytes } from "firebase/firestore";
import * as Y from 'yjs';
import _ from 'lodash';
import jmespath from 'jmespath';
import { customer as customerData, ItemsData } from "./data";

const GRAPHQL_ENDPOINT = "https://erp.elbrit.org/api/method/graphql";
const AUTH_TOKEN = "token 3b60e5e5e69347a:f2ce988fc4f0da1";

const MY_QUERY = `
query MyQuery($first: Int = 100, $startDate: String!, $endDate: String!, $operator: DBFilterOperator!, $values: [String] = "", $status: [String] = "") {
  withPurpose: SalesInvoices(
    first: $first
    filter: [{fieldname: "fsl_purpose", operator: NEQ, value: ""}, {fieldname: "posting_date", operator: GTE, value: $startDate}, {fieldname: "posting_date", operator: LTE, value: $endDate}, {fieldname: "customer_name", operator: $operator, values: $values}]
    
  ) {
    edges {
      node {
        ...inv
        fsl_purpose
      }
    }
  }
  withoutPurpose: SalesInvoices(
    first: $first
    filter: [{fieldname: "fsl_purpose", operator: EQ, value: ""}, {fieldname: "posting_date", operator: GTE, value: $startDate}, {fieldname: "posting_date", operator: LTE, value: $endDate}, {fieldname: "customer_name", operator: $operator, values: $values}]
  ) {
    edges {
      node {
        ...inv
      }
    }
  }
  postingDetails: SalesInvoices(
    first: 1
    filter: [{fieldname: "posting_date", operator: GTE, value: $startDate}, {fieldname: "posting_date", operator: LTE, value: $endDate}, {fieldname: "customer_name", operator: $operator, values: $values}, {fieldname: "status", operator: NOT_IN, values: $status}]
    sortBy: {direction: DESC, field: CREATION}
  ) {
    edges {
      node {
        posting_date
        posting_time
        name
      }
    }
  }
  Targets(
    filter: [{fieldname: "date", operator: GTE, value: $startDate}, {fieldname: "date", operator: LTE, value: $endDate}]
    first: 1000
  ) {
    edges {
      node {
        date
        hq__name
        name
        salesteam__name
        value
      }
    }
  }
}

fragment inv on SalesInvoice {
  customer_name
  customer_group__name
  currency__name
  company_address__name
  posting_date
  is_return
  is_pos
  is_reverse_charge
  is_internal_customer
  is_discounted
  whg_ebs_code
  whg_ignore_invoice
  company__name
  fsl_sample
  fsl_claim
  total_qty
  total
  grand_total
  name
  whg_ignore_invoice
  items {
    brand
    amount
    base_amount
    is_free_item
    base_net_rate
    base_net_amount
    base_rate
    taxable_value
    batch_no__name
    customer_item_code
    fsl_expiry
    fsl_return_batch
    fsl_sales_return__name
    fsl_ptr
    fsl_pts
    fsl_mrp
    item_code__name
    item_name
    net_amount
    net_rate
    rate
    price_list_rate
    qty
    base_price_list_rate
    warehouse__name
    fsl_elbrit_sales_team__name
    discount_percentage
    discount_amount
  }
  status
  customer {
    sales_team_role_id {
      sales_team_role_id {
        hq__name
        sales_team__name
      }
    }
  }
}
`;

const VARIABLES = {
  first: 100,
  startDate: "2025-12-01",
  endDate: "2025-12-30",
  operator: "NOT_IN",
  values: [],
  status: ["RETURN", "DRAFT"]
};

const getValidTeams = (items, itemName, postingDate) => {
  const item = items?.[itemName];
  if (!item) return {};
  const d = new Date(postingDate);
  return Object.fromEntries(Object.entries(item.team ?? {}).filter(([, t]) => (!t.valid_from || d >= new Date(t.valid_from)) && (!t.valid_to || d <= new Date(t.valid_to))))
}

// Function to add sales team and HQ information
const addStHq = (itemMap, cusMap, data, itemKey, dateKey, cusKey, hqKey) => {
  const itemStArr = getValidTeams(itemMap, data[itemKey], data[dateKey])
  const custTeam = cusMap[data[cusKey].trim()] || {}
  const st = _.intersection(Object.keys(custTeam), Object.keys(itemStArr))
  let sthq = {"sales_team": null, "hq": null}
  if (st.length > 0) sthq = {"sales_team": st[0], "hq": custTeam[st[0]][hqKey]}
  if (st.length > 1) console.log("Extra mapping found :", data)
  return {...data, ...sthq}
}

const processGraphQLData = (result) => {
  let primaryWithPurpose = jmespath.search(result, "data.withPurpose.edges[*].node") || [];
  let primaryWithoutPurpose = jmespath.search(result, "data.withoutPurpose.edges[*].node") || [];
  let target = jmespath.search(result, "data.Targets.edges[*].node") || [];
  let primary = [
    ...primaryWithPurpose,
    ...primaryWithoutPurpose
  ];

  if (primary.length === 0) return {};

  let items = ItemsData;
  let customer = customerData;

  const validKeys = primary[0] ? Object.entries(primary[0]).reduce((a, [k, v]) => v === null || [
    "string",
    "number",
    "boolean"
  ].includes(typeof v) ? (a.push(k), a) : a, []) : [];

  let merge = primary.flatMap(({ items: invoiceItems, ...parent }) => (invoiceItems || []).map(item => ({
    ...Object.fromEntries(Object.entries(parent).filter(([, v]) => v === null || [
      "string",
      "number",
      "boolean"
    ].includes(typeof v))),
    ...item
  })));

  const enriched = merge.map(x => addStHq(items, customer, x, "item_name", "posting_date", "customer_name", "hq__name"));

  const teamWise = enriched.reduce((acc, row) => {
    const team = row.sales_team || "UNKNOWN_TEAM";
    const hq = row.hq || row.hq__name || "UNKNOWN_HQ";
    if (!acc[team])
      acc[team] = {};
    if (!acc[team][hq])
      acc[team][hq] = [];
    acc[team][hq].push(row);
    return acc
  }, {});

  console.log(teamWise);
  return teamWise;
};

export const seedDatabase = async (customStartDate, customEndDate, targetMonth) => {
  try {
    const startDate = customStartDate || VARIABLES.startDate;
    const endDate = customEndDate || VARIABLES.endDate;
    const activeMonth = targetMonth || (startDate ? startDate.substring(0, 7) : "unknown");

    console.log(`Fetching live data from GraphQL for period: ${startDate} to ${endDate} (Target: ${activeMonth})...`);
    
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": AUTH_TOKEN
      },
      body: JSON.stringify({
        query: MY_QUERY,
        variables: {
          ...VARIABLES,
          startDate,
          endDate
        }
      })
    });

    const result = await response.json();

    if (result.errors) {
      console.error("GraphQL Errors:", result.errors);
      throw new Error(result.errors[0].message);
    }

    console.log("GraphQL fetch complete. Received data from ERP.");

    const data = processGraphQLData(result);
    console.log("Formatting complete. Data flattened and grouped by Team and HQ.");

    console.log(`Starting database seed for month ${activeMonth} with Yjs Binary (Uint8Array) format...`);
    
    // Step 1: Group data for the target month
    // We force all fetched data into the activeMonth requested by the user
    const groupedData = { [activeMonth]: data }; 

    // Step 2: Upload to Firestore
    for (const [month, teams] of Object.entries(groupedData)) {
      const monthRef = doc(db, "Primary", month);
      const teamNames = Object.keys(teams);
      
      // Initialize a "Master" Yjs state for the month
      const monthYDoc = new Y.Doc();
      const monthYArray = monthYDoc.getArray('data');

      console.log(`Processing Month: ${month}`);

      for (const [teamName, hqs] of Object.entries(teams)) {
        console.log(`  Seeding Team Collection: "Primary/${month}/${teamName}"`);
        for (const [hqName, hqData] of Object.entries(hqs)) {
          // Create a temporary Y.Doc for THIS SPECIFIC HQ to generate a clean binary update
          const tempHqDoc = new Y.Doc();
          const tempHqArray = tempHqDoc.getArray('data');
          
          const recordsWithContext = hqData.map(item => ({
            ...item,
            sales_team: teamName,
            hq: hqName
          }));
          
          tempHqArray.insert(0, recordsWithContext);
          const hqUpdateBinary = Y.encodeStateAsUpdate(tempHqDoc);
          
          // Also add to the month-level YDoc
          monthYArray.push(recordsWithContext);

          // Path: Primary (coll) -> Month (doc) -> [TeamName] (coll) -> [HQName] (doc)
          const hqRef = doc(db, "Primary", month, teamName, hqName);
          console.log(`  -> Preparing to push HQ: "Primary/${month}/${teamName}/${hqName}" (${hqData.length} records, ${hqUpdateBinary.length} bytes)`);
          
          if (hqUpdateBinary.length > 100000000) {
            console.error(`  !! ERROR: HQ "${hqName}" binary size (${hqUpdateBinary.length} bytes) exceeds Firestore 1MB limit. Skipping this document to prevent crash.`);
            continue; // Skip this HQ
          }

          try {
            await setDoc(hqRef, {
              hq: hqName,
              sales_team: teamName,
              // STORE AS UNIT8ARRAY (Firestore Bytes)
              hqUpdate: Bytes.fromUint8Array(hqUpdateBinary),
              last_updated: new Date().toISOString()
            });
            console.log(`  -> Successfully pushed HQ: ${hqName}`);
          } catch (pushErr) {
            console.error(`  !! FAILED to push HQ ${hqName}:`, pushErr);
          }
        }
      }

      // Save the master state for the whole month in the month document itself
      const monthUpdateBinary = Y.encodeStateAsUpdate(monthYDoc);
      const monthDocData = { 
        month, 
        teams: teamNames,
        last_updated: new Date().toISOString() 
      };

      // Firestore limit check for master state: Document limit is 1 MiB (1,048,576 bytes)
      // We check for 900,000 to be safe with metadata
      if (monthUpdateBinary.length < 900000000) {
        monthDocData.ydocState = Bytes.fromUint8Array(monthUpdateBinary);
        console.log(`  -> Adding master ydocState to Month doc (${monthUpdateBinary.length} bytes)`);
      } else {
        console.warn(`  -> Master ydocState (${monthUpdateBinary.length} bytes) exceeds Firestore 1MB limit. Skipping ydocState in Primary/${month} document.`);
      }

      console.log(`Pushing month metadata to "Primary/${month}"...`);
      // await setDoc(monthRef, monthDocData, { merge: true });
      console.log(`Month metadata for ${month} successfully pushed.`);
    }

    console.log(`Successfully seeded 'Primary/${activeMonth}' with Yjs Binary structure`);
    console.log("There is one more problem: The total data size for the month might exceed the master document limit, but individual HQs are stored separately.");
    alert(`Seeding complete for ${activeMonth}! Data is now stored as binary for high-performance sync.`);
  } catch (error) {
    console.error("Error seeding database:", error);
    alert(`Error seeding database: ${error.message}`);
  }
};
