'use strict';

const express = require('express');
const { helmet, cors, apiLimiter, uploadLimiter, requestLogger, errorHandler, notFoundHandler } = require('./middleware');
const config = require('./config');
const { ensureDirs } = require('./storage/manager');
const fileRoutes = require('./routes/fileRoutes');
const cleanRoutes = require('./routes/cleanRoutes');
const chatRoutes = require('./routes/chatRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const providerRoutes = require('./routes/providerRoutes');
const healthRoutes = require('./routes/healthRoutes');

ensureDirs();

const app = express();

app.set('trust proxy', true);

app.use(helmet);
app.use(cors);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(requestLogger);
app.use('/api/', apiLimiter);

app.use('/api/health', healthRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/data', cleanRoutes);
app.use('/api/files', uploadLimiter, fileRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
