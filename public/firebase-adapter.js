/*
  Conecta la app con Firebase.
  - Login con Google (Firebase Authentication)
  - Datos guardados en Firestore
  Expone window.claude.use("db") y window.claude.use("user") para que app.js
  funcione sin cambios. Si firebase-config.js no está completo, la app
  arranca en "modo local" (se guarda solo en este navegador).
*/
(function () {
  const cfg = window.firebaseConfig;
  if (!window.firebase || !cfg || String(cfg.apiKey || "").startsWith("TU_")) {
    console.warn("Firebase no está configurado: la app funciona en modo local.");
    return;
  }

  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const fs = firebase.firestore();

  /* ---------- pantalla de login ---------- */
  const css = document.createElement("style");
  css.textContent = `
    #loginScreen{position:fixed;inset:0;z-index:100;background:var(--paper);display:grid;place-items:center;padding:24px}
    #loginScreen .card{max-width:380px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;text-align:center}
    #loginScreen h1{font-family:var(--display);font-size:1.7rem;margin:0 0 8px}
    #loginScreen p{color:var(--muted);margin:0 0 20px}
    #loginScreen .err{color:var(--warn);margin-top:12px;font-size:.9rem}
    #logoutBtn{margin-left:10px}`;
  document.head.appendChild(css);

  function showLogin() {
    if (document.getElementById("loginScreen")) return;
    const el = document.createElement("div");
    el.id = "loginScreen";
    el.innerHTML = `<div class="card">
        <h1>Sistema Estudiantes</h1>
        <p>Ingresá con tu cuenta para guardar tus materias, resúmenes y chatear con tus amigos.</p>
        <button class="btn" id="googleBtn" type="button">Ingresar con Google</button>
        <div class="err" id="loginErr"></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector("#googleBtn").onclick = async () => {
      try {
        await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      } catch (e) {
        el.querySelector("#loginErr").textContent = "No se pudo iniciar sesión: " + (e.message || e.code);
      }
    };
  }
  function hideLogin() { document.getElementById("loginScreen")?.remove(); }

  function addLogout() {
    if (document.getElementById("logoutBtn")) return;
    const b = document.createElement("button");
    b.id = "logoutBtn";
    b.className = "btn ghost small";
    b.textContent = "Cerrar sesión";
    b.onclick = () => auth.signOut().then(() => location.reload());
    document.querySelector("header.top")?.appendChild(b);
  }

  /* ---------- sesión ---------- */
  let resolved = false;
  const ready = new Promise((resolve) => {
    auth.onAuthStateChanged(async (u) => {
      if (!u) { if (resolved) location.reload(); else showLogin(); return; }
      hideLogin();
      try {
        // Perfil público (nombre y foto) para que los amigos te vean
        await fs.doc("perfiles/" + u.uid).set({ nombre: u.displayName || "", foto: u.photoURL || "" }, { merge: true });
      } catch (e) { console.warn(e); }
      let admin = false;
      try { admin = (await fs.doc("admins/" + u.uid).get()).exists; } catch (e) {}
      addLogout();
      resolved = true;
      resolve({ u, admin });
    });
  });

  /* ---------- API "user" que usa app.js ---------- */
  const cache = {};
  const userApi = {
    id: async () => (await ready).u.uid,
    canEdit: async () => (await ready).admin,
    isOwner: async () => (await ready).admin,
    name: async () => (await ready).u.displayName || "",
    async profiles(ids) {
      ids = [...new Set(Array.isArray(ids) ? ids : [ids])];
      const me = auth.currentUser?.uid;
      const out = {};
      await Promise.all(ids.map(async (id) => {
        if (!cache[id]) {
          try {
            const s = await fs.doc("perfiles/" + id).get();
            const d = s.exists ? s.data() : {};
            cache[id] = { id, name: d.nombre || "", avatarUrl: d.foto || "", isMe: id === me, guest: false };
          } catch (e) {
            cache[id] = { id, name: "", avatarUrl: "", isMe: id === me, guest: false };
          }
        }
        out[id] = cache[id];
      }));
      return out;
    },
    search: async () => [] // la app busca entre las personas que ya usan la app
  };

  window.claude = {
    async use(name) {
      await ready;
      if (name === "db") return fs;      // Firestore tiene la misma forma que usa app.js
      if (name === "user") return userApi;
      return null;
    }
  };
})();