# Usar imagen base de Apify con Playwright preinstalado
FROM apify/actor-node-playwright-chrome:20

# Copiar archivos del proyecto
COPY package*.json ./

# Instalar dependencias (sin reinstalar playwright, usar el de la imagen)
RUN npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copiar código fuente
COPY . ./

# Ejecutar el actor
CMD npm start
