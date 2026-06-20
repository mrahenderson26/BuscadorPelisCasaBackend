const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

const PRODUCTION_FRONTEND_URL = "https://lambent-faun-f0f886.netlify.app";
const LOCAL_FRONTEND_URLS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const normalizeOrigin = (origin = "") => origin.trim().replace(/\/+$/, "");

const configuredFrontendUrls = (process.env.FRONTEND_URL || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = new Set(
  [PRODUCTION_FRONTEND_URL, ...LOCAL_FRONTEND_URLS, ...configuredFrontendUrls]
    .map(normalizeOrigin)
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests such as curl, Render health checks, and local API tests.
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowedOrigins.has(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS bloqueado para el origen: ${origin}`));
    },
  })
);

app.use(express.json());

const moviesPath = path.resolve(__dirname, "peliculas.json");
const uploadsDir = path.resolve(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));

const posterStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
    callback(null, safeName);
  },
});

const posterUpload = multer({
  storage: posterStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }

    callback(new Error("Solo se permiten archivos de imagen para el póster"));
  },
});

const removeDiacritics = (value) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const normalizeText = (value) => removeDiacritics(String(value || "")).toLowerCase().trim();

const loadMovies = () => {
  const content = fs.readFileSync(moviesPath, "utf-8");
  const parsed = JSON.parse(content);
  return parsed.map((movie, index) => ({ id: index, ...movie }));
};

const saveMovies = () => {
  const toWrite = movies.map(({ id, ...movie }) => movie);
  fs.writeFileSync(moviesPath, `${JSON.stringify(toWrite, null, 2)}\n`, "utf-8");
  movies = loadMovies();
};

const parseStringList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const parseNumber = (value, fieldName) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`El campo "${fieldName}" debe ser numérico`);
  }

  return parsed;
};

const buildPosterUrl = (req, file, posterUrl) => {
  if (file) {
    return `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;
  }

  const trimmed = String(posterUrl || "").trim();

  if (!trimmed) {
    throw new Error("Debes proporcionar una URL de póster o subir una imagen");
  }

  return trimmed;
};

const extractUploadFilename = (poster) => {
  if (typeof poster !== "string") {
    return null;
  }

  const marker = "/uploads/";
  const index = poster.indexOf(marker);

  if (index === -1) {
    return null;
  }

  return poster.slice(index + marker.length);
};

const deleteUploadedPoster = (poster) => {
  const filename = extractUploadFilename(poster);

  if (!filename || filename.includes("..") || filename.includes("/")) {
    return;
  }

  const filePath = path.join(uploadsDir, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

const buildMovieFromBody = (req, file) => {
  const body = req.body || {};
  const titulo = String(body.titulo || "").trim();
  const title = String(body.title || "").trim();
  const director = String(body.director || "").trim();
  const directorEn = String(body.director_en || body.directorEn || "").trim();
  const sinopsis = String(body.sinopsis || "").trim();
  const synopsis = String(body.synopsis || "").trim();

  if (!titulo) {
    throw new Error("El título en español es obligatorio");
  }

  if (!director) {
    throw new Error("El director es obligatorio");
  }

  if (!sinopsis) {
    throw new Error("La sinopsis en español es obligatoria");
  }

  const movie = {
    titulo,
    title: title || titulo,
    director,
    año: parseNumber(body.año ?? body.anio, "año"),
    generos: parseStringList(body.generos),
    genres: parseStringList(body.genres),
    actores: parseStringList(body.actores),
    puntuacion: parseNumber(body.puntuacion, "puntuacion"),
    duracion: parseNumber(body.duracion, "duracion"),
    poster: buildPosterUrl(req, file, body.poster),
    sinopsis,
    synopsis: synopsis || sinopsis,
  };

  if (directorEn) {
    movie.director_en = directorEn;
  }

  if (movie.generos.length === 0) {
    throw new Error("Debes indicar al menos un género en español");
  }

  if (movie.genres.length === 0) {
    movie.genres = [...movie.generos];
  }

  if (movie.actores.length === 0) {
    throw new Error("Debes indicar al menos un actor");
  }

  return movie;
};

let movies = loadMovies();

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "API del Buscador de Películas",
    endpoints: [
      "/api/health",
      "/api/movies",
      "/api/movies/:id",
      "POST /api/movies",
      "DELETE /api/movies/:id",
    ],
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, totalPeliculas: movies.length });
});

app.get("/api/movies", (req, res) => {
  const q = normalizeText(req.query.q || "");

  if (!q) {
    return res.json(movies);
  }

  const result = movies.filter((movie) => {
    const searchable = [
      movie.titulo,
      movie.title,
      movie.director,
      movie.director_en,
      movie.año,
      movie.puntuacion,
      movie.duracion,
      movie.sinopsis,
      movie.synopsis,
      ...(movie.generos || []),
      ...(movie.genres || []),
      ...(movie.actores || []),
    ]
      .map((value) => normalizeText(value))
      .join(" ");

    return searchable.includes(q);
  });

  return res.json(result);
});

app.get("/api/movies/:id", (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "El id debe ser numérico" });
  }

  const movie = movies.find((item) => item.id === id);

  if (!movie) {
    return res.status(404).json({ message: "Película no encontrada" });
  }

  return res.json(movie);
});

app.post("/api/movies", (req, res) => {
  const handleCreate = (error) => {
    if (error) {
      return res.status(400).json({ message: error.message });
    }

    try {
      const movie = buildMovieFromBody(req, req.file);
      movies.push(movie);
      saveMovies();
      const created = movies[movies.length - 1];
      return res.status(201).json(created);
    } catch (createError) {
      if (req.file) {
        deleteUploadedPoster(`${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`);
      }

      return res.status(400).json({ message: createError.message });
    }
  };

  if (req.is("multipart/form-data")) {
    return posterUpload.single("posterFile")(req, res, handleCreate);
  }

  return handleCreate();
});

app.delete("/api/movies/:id", (req, res) => {
  const id = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "El id debe ser numérico" });
  }

  const index = movies.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "Película no encontrada" });
  }

  const [deleted] = movies.splice(index, 1);
  deleteUploadedPoster(deleted.poster);

  try {
    saveMovies();
    return res.json({ ok: true, deleted });
  } catch (_error) {
    movies = loadMovies();
    return res.status(500).json({ message: "No se pudo eliminar la película" });
  }
});

app.post("/api/reload", (_req, res) => {
  try {
    movies = loadMovies();
    return res.json({ ok: true, totalPeliculas: movies.length });
  } catch (_error) {
    return res.status(500).json({ message: "No se pudo recargar la base de datos" });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error.message || error);
  res.status(500).json({ message: error.message || "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`API escuchando en el puerto ${PORT}`);
});
