require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log("SUPABASE_URL lue :", process.env.SUPABASE_URL);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;