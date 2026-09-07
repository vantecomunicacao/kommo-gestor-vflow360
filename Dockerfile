FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
# Webhook de erro DEDICADO ao VFlowKommo (item 1.3). Opcional: sem valor, o
# frontend não envia pro webhook (o log em system_logs continua). Cadastrar nos
# build args do Coolify.
ARG VITE_ERROR_WEBHOOK_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_ERROR_WEBHOOK_URL=$VITE_ERROR_WEBHOOK_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
