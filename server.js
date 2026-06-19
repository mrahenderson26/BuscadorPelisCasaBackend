const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

const frontendOrigin = process.env.FRONTEND_URL;

app.use(
  cors(
    frontendOrigin
      ? {
          origin: frontendOrigin.split(",").map((origin) => origin.trim()),
        }
      : undefined
  )
);

const moviesPath = path.resolve(__dirname, "peliculas.json");

const removeDiacritics = (value) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const normalizeText = (value) => removeDiacritics(String(value || "")).toLowerCase().trim();

const loadMovies = () => {
  const content = fs.readFileSync(moviesPath, "utf-8");
  const parsed = JSON.parse(content);
  return parsed.map((movie, index) => ({ id: index, ...movie }));
};

let movies = loadMovies();

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

app.post("/api/reload", (_req, res) => {
  try {
    movies = loadMovies();
    return res.json({ ok: true, totalPeliculas: movies.length });
  } catch (_error) {
    return res.status(500).json({ message: "No se pudo recargar la base de datos" });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT}`);
});
