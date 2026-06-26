const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const productosPath = path.resolve(__dirname, "productos.json");
const uploadsDir = path.resolve(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use("/uploads", express.static(uploadsDir));

const imagenStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
    callback(null, safeName);
  },
});

const imagenUpload = multer({
  storage: imagenStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
      return;
    }
    callback(new Error("Solo se permiten archivos de imagen"));
  },
});

const normalizeText = (value) => String(value || "").toLowerCase().trim();

const loadProductos = () => {
  const content = fs.readFileSync(productosPath, "utf-8");
  const parsed = JSON.parse(content);
  return parsed.map((producto, index) => ({ id: index, ...producto }));
};

const saveProductos = () => {
  const toWrite = productos.map(({ id, ...producto }) => producto);
  fs.writeFileSync(productosPath, `${JSON.stringify(toWrite, null, 2)}\n`, "utf-8");
  productos = loadProductos();
};

const extractUploadFilename = (imagen) => {
  if (typeof imagen !== "string") return null;
  const marker = "/uploads/";
  const index = imagen.indexOf(marker);
  if (index === -1) return null;
  return imagen.slice(index + marker.length);
};

const deleteUploadedImagen = (imagen) => {
  const filename = extractUploadFilename(imagen);
  if (!filename || filename.includes("..") || filename.includes("/")) return;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const buildImagenUrl = (req, file, imagenUrl) => {
  if (file) {
    return `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;
  }
  const trimmed = String(imagenUrl || "").trim();
  if (!trimmed) return "";
  return trimmed;
};

const buildProductoFromBody = (req, file) => {
  const body = req.body || {};
  const nombre = String(body.nombre || "").trim();
  const precio = parseFloat(body.precio);

  if (!nombre) {
    throw new Error("El nombre del producto es obligatorio");
  }

  if (!Number.isFinite(precio) || precio < 0) {
    throw new Error("El precio debe ser un número válido mayor o igual a 0");
  }

  return {
    nombre,
    precio,
    imagen: buildImagenUrl(req, file, body.imagen),
  };
};

let productos = loadProductos();

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "API de Catálogo de Productos",
    endpoints: [
      "/api/health",
      "/api/productos",
      "/api/productos/:id",
      "POST /api/productos",
      "DELETE /api/productos/:id",
    ],
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, totalProductos: productos.length });
});

app.get("/api/productos", (req, res) => {
  const q = normalizeText(req.query.q || "");
  if (!q) {
    return res.json(productos);
  }
  const result = productos.filter((producto) => {
    const searchable = normalizeText(producto.nombre);
    return searchable.includes(q);
  });
  return res.json(result);
});

app.get("/api/productos/:id", (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "El id debe ser numérico" });
  }
  const producto = productos.find((item) => item.id === id);
  if (!producto) {
    return res.status(404).json({ message: "Producto no encontrado" });
  }
  return res.json(producto);
});

app.post("/api/productos", (req, res) => {
  const handleCreate = (error) => {
    if (error) {
      return res.status(400).json({ message: error.message });
    }
    try {
      const producto = buildProductoFromBody(req, req.file);
      productos.push(producto);
      saveProductos();
      const created = productos[productos.length - 1];
      return res.status(201).json(created);
    } catch (createError) {
      if (req.file) {
        deleteUploadedImagen(`${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`);
      }
      return res.status(400).json({ message: createError.message });
    }
  };

  if (req.is("multipart/form-data")) {
    return imagenUpload.single("imagenFile")(req, res, handleCreate);
  }

  return handleCreate();
});

app.delete("/api/productos/:id", (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ message: "El id debe ser numérico" });
  }
  const index = productos.findIndex((item) => item.id === id);
  if (index === -1) {
    return res.status(404).json({ message: "Producto no encontrado" });
  }
  const [deleted] = productos.splice(index, 1);
  deleteUploadedImagen(deleted.imagen);
  try {
    saveProductos();
    return res.json({ ok: true, deleted });
  } catch (_error) {
    productos = loadProductos();
    return res.status(500).json({ message: "No se pudo eliminar el producto" });
  }
});

app.post("/api/reload", (_req, res) => {
  try {
    productos = loadProductos();
    return res.json({ ok: true, totalProductos: productos.length });
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
