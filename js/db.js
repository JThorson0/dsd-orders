// js/db.js — Firebase/Firestore layer.
// Loaded via dynamic import() ONLY when a Firebase config is present,
// so the app still boots (in local preview mode) with no network.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  increment,
  query,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

let db = null;
export function isLive() {
  return !!db;
}

// Sign in anonymously, enable IndexedDB offline persistence so the app
// keeps working in dead-signal stores and syncs when back online.
export async function init() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await signInAnonymously(auth);
  db = getFirestore(app);
  try {
    await enableIndexedDbPersistence(db);
  } catch (e) {
    console.warn("[dsd] Firestore offline persistence unavailable:", e);
  }
  return db;
}

export const qtyDocId = (storeId, productId) => `${storeId}___${productId}`;

// First run: seed Firestore from the bundled catalog.
export async function seedIfEmpty(catalog) {
  const snap = await getDocs(query(collection(db, "products"), limit(1)));
  if (!snap.empty) return false;
  const batch = writeBatch(db);
  for (const p of catalog.products) {
    batch.set(doc(db, "products", p.id), {
      name: p.name,
      itemNumber: p.itemNumber || "",
      category: p.category || "Uncategorized",
      aliases: p.aliases || "",
      archived: !!p.archived,
      sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : 9999,
    });
  }
  for (const s of catalog.stores) {
    batch.set(doc(db, "stores", s.id), {
      name: s.name,
      shortName: s.shortName || "",
      chain: s.chain || "",
      sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : 99,
      archived: !!s.archived,
      lastOrderLabel: s.lastOrderLabel || "",
    });
  }
  for (const q of catalog.orderQuantities || []) {
    batch.set(doc(db, "orderQuantities", qtyDocId(q.storeId, q.productId)), {
      storeId: q.storeId,
      productId: q.productId,
      currentQty: q.currentQty || 0,
      lastQty: q.lastQty || 0,
      updatedAt: q.updatedAt || new Date().toISOString(),
    });
  }
  await batch.commit();
  return true;
}

// Live listener: cb(rows) with [{id, ...data}]. Returns unsubscribe.
export function watch(collectionName, cb) {
  return onSnapshot(
    collection(db, collectionName),
    (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      cb(rows);
    },
    (err) => console.error("[dsd] snapshot error:", collectionName, err)
  );
}

export async function setQuantity(storeId, productId, currentQty, lastQty) {
  await setDoc(
    doc(db, "orderQuantities", qtyDocId(storeId, productId)),
    {
      storeId,
      productId,
      currentQty,
      lastQty,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

// Chunked batch write (Firestore limit: 500 writes per batch).
export async function setQuantities(list) {
  for (let i = 0; i < list.length; i += 450) {
    const batch = writeBatch(db);
    for (const q of list.slice(i, i + 450)) {
      batch.set(
        doc(db, "orderQuantities", qtyDocId(q.storeId, q.productId)),
        {
          storeId: q.storeId,
          productId: q.productId,
          currentQty: q.currentQty,
          lastQty: q.lastQty,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

export async function markSubmitted(cycleKey) {
  await setDoc(
    doc(db, "otsSubmissions", cycleKey),
    { submittedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function saveProduct(p) {
  const id = p.id || "user-" + Date.now().toString(36);
  await setDoc(
    doc(db, "products", id),
    {
      name: p.name,
      itemNumber: p.itemNumber || "",
      category: p.category || "Uncategorized",
      aliases: p.aliases || "",
      archived: !!p.archived,
      sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : 9999,
    },
    { merge: true }
  );
  return id;
}

export async function setProductArchived(id, archived) {
  await setDoc(doc(db, "products", id), { archived: !!archived }, { merge: true });
}

export async function saveStore(s) {
  const id = s.id || "store-" + Date.now().toString(36);
  await setDoc(
    doc(db, "stores", id),
    {
      name: s.name,
      shortName: s.shortName || "",
      chain: s.chain || "",
      sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : 99,
      archived: !!s.archived,
      lastOrderLabel: s.lastOrderLabel || "",
    },
    { merge: true }
  );
  return id;
}

export async function setStoreArchived(id, archived) {
  await setDoc(doc(db, "stores", id), { archived: !!archived }, { merge: true });
}

export async function recordRecent(storeId, productId) {
  const ref = doc(db, "quickRecents", storeId);
  const snap = await getDoc(ref);
  const ids = snap.exists() ? snap.data().productIds || [] : [];
  const next = [productId, ...ids.filter((x) => x !== productId)].slice(0, 8);
  await setDoc(ref, { storeId, productIds: next }, { merge: true });
}

export async function bumpUseCount(productId) {
  await setDoc(
    doc(db, "productUseCounts", productId),
    { productId, count: increment(1) },
    { merge: true }
  );
}

export async function exportAll() {
  const out = {};
  for (const c of [
    "products",
    "stores",
    "orderQuantities",
    "otsSubmissions",
    "quickRecents",
    "productUseCounts",
  ]) {
    const snap = await getDocs(collection(db, c));
    out[c] = [];
    snap.forEach((d) => out[c].push({ id: d.id, ...d.data() }));
  }
  out.exportedAt = new Date().toISOString();
  return out;
}

export async function importAll(data) {
  const writes = [];
  for (const p of data.products || [])
    writes.push(["products", p.id, p]);
  for (const s of data.stores || []) writes.push(["stores", s.id, s]);
  for (const q of data.orderQuantities || [])
    writes.push(["orderQuantities", qtyDocId(q.storeId, q.productId), q]);
  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(db);
    for (const [col, id, row] of writes.slice(i, i + 450)) {
      const { id: _drop, ...rest } = row;
      batch.set(doc(db, col, id), rest, { merge: true });
    }
    await batch.commit();
  }
}
