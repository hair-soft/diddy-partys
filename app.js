
const SUPABASE_URL = "DEINE_SUPABASE_URL";
const SUPABASE_ANON_KEY = "DEIN_SUPABASE_ANON_KEY";

const configured =
  !SUPABASE_URL.includes("DEINE_") &&
  !SUPABASE_ANON_KEY.includes("DEIN_");

const supabaseClient = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const BUCKET = "photos";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");
const copyStatus = document.getElementById("copyStatus");
const gallery = document.getElementById("gallery");
const emptyState = document.getElementById("emptyState");
const refreshBtn = document.getElementById("refreshBtn");

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("error", error);
}

// Countdown: Partybeginn 23.10.2026, 20:00 Uhr deutscher Zeit.
function updateCountdown() {
  const target = new Date("2026-10-23T20:00:00+02:00").getTime();
  const remaining = Math.max(0, target - Date.now());

  document.getElementById("days").textContent =
    String(Math.floor(remaining / 86400000)).padStart(2, "0");

  document.getElementById("hours").textContent =
    String(Math.floor(remaining / 3600000) % 24).padStart(2, "0");

  document.getElementById("minutes").textContent =
    String(Math.floor(remaining / 60000) % 60).padStart(2, "0");

  document.getElementById("seconds").textContent =
    String(Math.floor(remaining / 1000) % 60).padStart(2, "0");
}

updateCountdown();
setInterval(updateCountdown, 1000);

// QR-Code führt direkt zu dieser Webseite.
async function createQRCode() {
  const canvas = document.getElementById("qr");

  try {
    await QRCode.toCanvas(canvas, window.location.href, {
      width: 200,
      margin: 2,
      color: {
        dark: "#101727",
        light: "#ffffff"
      }
    });
  } catch (error) {
    console.error("QR-Code konnte nicht erstellt werden:", error);
  }
}

// Link kopieren.
document.getElementById("copyLinkBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    setStatus(copyStatus, "Party-Link wurde kopiert!");
  } catch {
    setStatus(
      copyStatus,
      "Kopieren nicht möglich. Kopiere die Adresse aus der Browserleiste.",
      true
    );
  }
});

// Upload-Dialog öffnen.
uploadBtn.addEventListener("click", () => {
  if (!configured) {
    setStatus(
      uploadStatus,
      "Bitte richte zuerst Supabase ein und trage URL und Schlüssel in app.js ein.",
      true
    );
    return;
  }

  fileInput.click();
});

// Bilder optional verkleinern, damit Uploads schneller sind.
async function prepareImage(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} ist keine Bilddatei.`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`${file.name} ist größer als 10 MB.`);
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error(
      `${file.name}: Bitte verwende JPG, PNG oder WebP.`
    );
  }

  // JPG/WebP werden bei Bedarf auf maximal 2000 px verkleinert.
  if (file.type === "image/png") return file;

  const bitmap = await createImageBitmap(file);
  const maxDimension = 2000;
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height)
  );

  if (scale === 1 && file.size < 2 * 1024 * 1024) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise(resolve => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });

  if (!blob) {
    throw new Error(`Bild konnte nicht verarbeitet werden: ${file.name}`);
  }

  return new File(
    [blob],
    `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
    { type: "image/jpeg" }
  );
}

// Fotos in Supabase Storage hochladen.
async function uploadPhotos(files) {
  if (!supabaseClient) {
    setStatus(uploadStatus, "Supabase ist noch nicht eingerichtet.", true);
    return;
  }

  if (files.length > MAX_FILES_PER_UPLOAD) {
    setStatus(
      uploadStatus,
      `Bitte wähle höchstens ${MAX_FILES_PER_UPLOAD} Fotos gleichzeitig.`,
      true
    );
    return;
  }

  if (!files.length) return;

  uploadBtn.disabled = true;
  let success = 0;
  const errors = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];

    try {
      setStatus(
        uploadStatus,
        `Verarbeite Foto ${index + 1} von ${files.length} …`
      );

      const processed = await prepareImage(file);
      const extension = processed.type === "image/png" ? "png" : "jpg";
      const path = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

      const { error } = await supabaseClient.storage
        .from(BUCKET)
        .upload(path, processed, {
          cacheControl: "3600",
          upsert: false,
          contentType: processed.type
        });

      if (error) throw error;
      success++;
    } catch (error) {
      console.error(error);
      errors.push(error.message || "Upload fehlgeschlagen.");
    }
  }

  uploadBtn.disabled = false;
  fileInput.value = "";

  if (success > 0) {
    setStatus(
      uploadStatus,
      `${success} Foto(s) erfolgreich hochgeladen!` +
      (errors.length ? ` ${errors.length} Foto(s) fehlgeschlagen.` : "")
    );
  } else {
    setStatus(
      uploadStatus,
      errors[0] || "Upload fehlgeschlagen. Bitte versuche es erneut.",
      true
    );
  }

  await loadGallery();
}

fileInput.addEventListener("change", () => {
  uploadPhotos([...fileInput.files]);
});

// Gemeinsame Galerie aus dem Supabase-Bucket laden.
async function loadGallery() {
  if (!supabaseClient) {
    gallery.innerHTML = "";
    emptyState.hidden = false;
    emptyState.querySelector("h3").textContent = "Galerie noch nicht verbunden";
    emptyState.querySelector("p").textContent =
      "Richte Supabase ein, damit die hochgeladenen Fotos hier erscheinen.";
    return;
  }

  refreshBtn.disabled = true;

  const { data, error } = await supabaseClient.storage
    .from(BUCKET)
    .list("", {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" }
    });

  refreshBtn.disabled = false;

  if (error) {
    console.error(error);
    emptyState.hidden = false;
    emptyState.querySelector("h3").textContent = "Galerie nicht erreichbar";
    emptyState.querySelector("p").textContent =
      "Prüfe die Supabase-Verbindung und die Bucket-Berechtigungen.";
    return;
  }

  gallery.replaceChildren();

  const photos = (data || []).filter(item =>
    /\.(jpe?g|png|webp)$/i.test(item.name)
  );

  if (!photos.length) {
    emptyState.hidden = false;
    emptyState.querySelector("h3").textContent = "Noch keine Fotos";
    emptyState.querySelector("p").textContent =
      "Sei der Erste und teile einen Moment mit uns.";
    return;
  }

  emptyState.hidden = true;

  for (const photo of photos) {
    const { data: urlData } = supabaseClient.storage
      .from(BUCKET)
      .getPublicUrl(photo.name);

    const button = document.createElement("button");
    button.className = "photo-card";
    button.type = "button";
    button.setAttribute("aria-label", "Foto in Vollbild anzeigen");

    const img = document.createElement("img");
    img.src = urlData.publicUrl;
    img.alt = "Hausparty-Foto";
    img.loading = "lazy";

    button.appendChild(img);
    button.addEventListener("click", () => openLightbox(urlData.publicUrl));
    gallery.appendChild(button);
  }
}

function openLightbox(url) {
  const lightbox = document.getElementById("lightbox");
  document.getElementById("lightboxImage").src = url;
  lightbox.hidden = false;
}

function closeLightbox() {
  document.getElementById("lightbox").hidden = true;
  document.getElementById("lightboxImage").src = "";
}

document.getElementById("closeLightbox")
  .addEventListener("click", closeLightbox);

document.getElementById("lightbox").addEventListener("click", event => {
  if (event.target.id === "lightbox") closeLightbox();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeLightbox();
});

refreshBtn.addEventListener("click", loadGallery);

// Galerie regelmäßig aktualisieren.
createQRCode();
loadGallery();
setInterval(loadGallery, 30000);
