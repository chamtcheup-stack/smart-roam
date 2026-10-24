const express = require('express');
const router = express.Router();
const { createUser, getUser } = require('../controllers/usersController');

// Route POST pour créer un utilisateur
router.post('/', createUser);

// Route GET pour récupérer un utilisateur par son ID
router.get('/:id', getUser);

module.exports = router;