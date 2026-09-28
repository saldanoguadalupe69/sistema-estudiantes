/*
  Conexión con la IA (Gemini) usando Firebase AI Logic.
  La clave de Gemini NO está en este código: la guarda Firebase.
  Prueba varios modelos y se queda con el primero que funcione en tu proyecto.
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";

const SISTEMA = `Sos un tutor para estudiantes universitarios de Argentina, dentro de la app "Sistema Estudiantes".
Respondé en español rioplatense (voseo), con tono cercano pero claro y preciso.
Explicá paso a paso, con ejemplos concretos cuando ayuden.
Formato: usá markdown simple (títulos cortos con ##, **negritas**, listas con guiones). No uses tablas.
Para matemática NO uses LaTeX: escribí en texto plano, por ejemplo x^2, raíz(x), ∫ f(x) dx, a/b.
Si no sabés algo o la información no alcanza, decilo en vez de inventar.
Si te piden resolver un examen que está en curso, ayudá a entender el tema en lugar de dar solo la respuesta.`;

// Orden en que se prueban los modelos (el de firebase-config.js va primero)
const CANDIDATOS = [
  window.iaModelo,
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
].filter((m, i, a) => m && a.indexOf(m) === i);

// Errores que indican "este modelo no sirve, probá otro"
const MODELO_NO_SIRVE = /not.?found|\b404\b|not supported|no longer available|deprecated|decommission|limit:\s*0\b|is not available|permission.*model/i;

const cfg = window.firebaseConfig;
if (cfg && !String(cfg.apiKey || "").startsWith("TU_")) {
  try {
    const app = initializeApp(cfg, "ia");
    const ai = getAI(app, { backend: new GoogleAIBackend() });

    let guardado = null;
    try { guardado = localStorage.getItem("se:iaModeloOK"); } catch (e) {}
    const lista = guardado && CANDIDATOS.includes(guardado)
      ? [guardado, ...CANDIDATOS.filter(m => m !== guardado)]
      : CANDIDATOS;
    let idx = 0;

    const cache = {};
    const modelo = (json) => {
      const nombre = lista[idx], k = nombre + (json ? ":json" : "");
      if (!cache[k]) cache[k] = getGenerativeModel(ai, {
        model: nombre,
        systemInstruction: SISTEMA,
        ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {})
      });
      return cache[k];
    };
    const exito = () => {
      window.IA.modelo = lista[idx];
      try { localStorage.setItem("se:iaModeloOK", lista[idx]); } catch (e) {}
    };
    // Ejecuta una llamada; si el modelo no existe, pasa al siguiente y reintenta
    async function conReintento(fn) {
      let ultimo;
      while (idx < lista.length) {
        try { const r = await fn(); exito(); return r; }
        catch (e) {
          ultimo = e;
          const msg = String(e?.message || e);
          if (MODELO_NO_SIRVE.test(msg) && idx < lista.length - 1) {
            console.warn(`Modelo ${lista[idx]} no disponible, pruebo el siguiente…`, msg);
            idx++; continue;
          }
          throw e;
        }
      }
      throw ultimo;
    }
    const trozo = (c) => { try { return c.text() || ""; } catch (e) { return ""; } };

    window.IA = {
      modelo: lista[0],
      async *stream(parts) {
        const r = await conReintento(() => modelo(false).generateContentStream(parts));
        for await (const c of r.stream) yield trozo(c);
      },
      async json(parts) {
        const r = await conReintento(() => modelo(true).generateContent(parts));
        const t = r.response.text().replace(/```json|```/g, "").trim();
        return JSON.parse(t);
      },
      chat(history) {
        return {
          async *enviar(parts) {
            const r = await conReintento(() => modelo(false).startChat({ history }).sendMessageStream(parts));
            for await (const ch of r.stream) yield trozo(ch);
          }
        };
      }
    };
    window.dispatchEvent(new Event("ia-lista"));
  } catch (e) {
    console.warn("La IA no está disponible:", e);
    window.IA_ERROR = e;
    window.dispatchEvent(new Event("ia-lista"));
  }
}