const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Groq = require('groq-sdk');
const https = require('https');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const CHANNEL_ID = process.env.CHANNEL_ID;

const SYSTEM_PROMPT = `Tu es un assistant expert en achat-revente sur Vinted. Tu aides à :
- Estimer si un article est une bonne affaire à acheter pour revendre
- Rédiger des annonces attractives pour Vinted
- Calculer les marges bénéficiaires
- Suggérer des prix de revente optimaux
Réponds toujours en français, de façon concise et pratique. Utilise des emojis.`;

// ─── SCRAPER ─────────────────────────────────────────────────────────────────
const MARQUES = ['Nike', 'Adidas', 'Jordan', 'New Balance', 'Ralph Lauren', 'Lacoste', 'Stone Island', 'CP Company', 'The North Face', 'Carhartt', 'Levi\'s', 'Tommy Hilfiger', 'Burberry', 'Moncler', 'Palace'];
;
const articlesVus = new Set();
let scraperInitialise = false;

function fetchVinted(marque) {
  return new Promise((resolve) => {
    const query = encodeURIComponent(marque);
    const options = {
      hostname: 'www.vinted.fr',
      path: `/api/v2/catalog/items?search_text=${query}&per_page=20&order=newest_first`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).items || []); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

async function scannerVinted() {
  if (!CHANNEL_ID) return;
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (!channel) return;

  for (const marque of MARQUES) {
    try {
      const articles = await fetchVinted(marque);
      for (const article of articles) {
        const id = article.id?.toString();
        if (!id || articlesVus.has(id)) continue;
        articlesVus.add(id);
        if (!scraperInitialise) continue;

        const prix = article.price ? `${article.price} €` : 'Prix inconnu';
        const taille = article.size_title || 'Non précisée';
        const etat = article.status || 'Non précisé';
        const lien = `https://www.vinted.fr/items/${id}`;

        const embed = new EmbedBuilder()
          .setColor(0x09B1BA)
          .setTitle(`🔔 Nouvelle annonce — ${article.title || marque}`)
          .addFields(
            { name: '💰 Prix', value: prix, inline: true },
            { name: '📏 Taille', value: taille, inline: true },
            { name: '✨ État', value: etat, inline: true },
            { name: '🔗 Lien', value: lien },
          )
          .setFooter({ text: `Marque surveillée : ${marque}` });

        if (article.photos?.[0]?.url) embed.setThumbnail(article.photos[0].url);
        await channel.send({ embeds: [embed] });
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`Erreur scraping ${marque}:`, err.message);
    }
  }
}

// ─── COMMANDES ────────────────────────────────────────────────────────────────
const COMMANDS = {
  '!aide': sendHelp,
  '!annonce': generateAnnonce,
  '!marge': calculerMarge,
  '!analyse': analyserArticle,
  '!prix': suggererPrix,
};

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);

  // Initialisation du scraper
  console.log('🔍 Initialisation du scraper Vinted...');
  const results = await Promise.all(MARQUES.map(m => fetchVinted(m)));
  results.flat().forEach(a => a.id && articlesVus.add(a.id.toString()));
  scraperInitialise = true;
  console.log(`✅ ${articlesVus.size} articles existants ignorés. Surveillance active !`);

  // Scan toutes les 2 minutes
  setInterval(scannerVinted, 2 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  const prefix = content.split(' ')[0].toLowerCase();
  if (COMMANDS[prefix]) {
    await COMMANDS[prefix](message, content);
    return;
  }
  if (message.mentions.has(client.user)) {
    const userMessage = content.replace(`<@${client.user.id}>`, '').trim();
    await repondreLibrement(message, userMessage);
  }
});

async function repondreLibrement(message, userMessage) {
  await message.channel.sendTyping();
  try {
    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
    });
    await message.reply(response.choices[0].message.content);
  } catch (err) {
    await message.reply('❌ Erreur. Réessaie dans un moment.');
  }
}

async function sendHelp(message) {
  const embed = new EmbedBuilder()
    .setColor(0x09B1BA)
    .setTitle('🛍️ Bot Vinted — Commandes disponibles')
    .addFields(
      { name: '!annonce [description]', value: 'Génère une annonce Vinted attractive' },
      { name: '!marge [prix achat] [prix revente]', value: 'Calcule ta marge nette après frais' },
      { name: '!analyse [description article]', value: 'Évalue si c\'est une bonne affaire' },
      { name: '!prix [marque] [article] [état]', value: 'Suggère un prix de revente optimal' },
      { name: '@Bot [question libre]', value: 'Pose n\'importe quelle question sur Vinted' },
    )
    .setFooter({ text: 'Powered by Groq AI | Scraper actif : Nike, Adidas, Ralph Lauren, Lacoste' });
  await message.reply({ embeds: [embed] });
}

async function generateAnnonce(message, content) {
  const description = content.replace('!annonce', '').trim();
  if (!description) return message.reply('❌ Usage : `!annonce [description]`');
  await message.channel.sendTyping();
  const response = await callGroq(`Génère une annonce Vinted complète pour : "${description}". Inclus titre, description, état, prix conseillé.`);
  await message.reply(response);
}

async function calculerMarge(message, content) {
  const parts = content.split(' ').filter(Boolean);
  const prixAchat = parseFloat(parts[1]);
  const prixRevente = parseFloat(parts[2]);
  if (isNaN(prixAchat) || isNaN(prixRevente)) return message.reply('❌ Usage : `!marge [prix achat] [prix revente]`');
  const fraisLivraison = 4.5;
  const beneficeNet = prixRevente - prixAchat - fraisLivraison;
  const marge = ((beneficeNet / prixAchat) * 100).toFixed(0);
  const embed = new EmbedBuilder()
    .setColor(beneficeNet > 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${beneficeNet > 0 ? '✅' : '❌'} Analyse de marge`)
    .addFields(
      { name: '💸 Prix achat', value: `${prixAchat.toFixed(2)} €`, inline: true },
      { name: '🏷️ Prix revente', value: `${prixRevente.toFixed(2)} €`, inline: true },
      { name: '📦 Frais livraison', value: `${fraisLivraison.toFixed(2)} €`, inline: true },
      { name: '💰 Bénéfice net', value: `**${beneficeNet.toFixed(2)} €**`, inline: true },
      { name: '📈 Taux de marge', value: `**${marge}%**`, inline: true },
    );
  await message.reply({ embeds: [embed] });
}

async function analyserArticle(message, content) {
  const description = content.replace('!analyse', '').trim();
  if (!description) return message.reply('❌ Usage : `!analyse [description + prix]`');
  await message.channel.sendTyping();
  const response = await callGroq(`Analyse cet article Vinted pour un acheteur-revendeur : "${description}". Dis-moi si c'est une bonne affaire, le potentiel de revente, le prix conseillé et les risques.`);
  await message.reply(response);
}

async function suggererPrix(message, content) {
  const description = content.replace('!prix', '').trim();
  if (!description) return message.reply('❌ Usage : `!prix [marque] [article] [état]`');
  await message.channel.sendTyping();
  const response = await callGroq(`Pour cet article Vinted : "${description}", donne le prix idéal de revente, le prix maximum, les mots-clés pour l'annonce et des astuces.`);
  await message.reply(response);
}

async function callGroq(userPrompt) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    });
    return response.choices[0].message.content;
  } catch (err) {
    return '❌ Erreur. Réessaie dans un moment.';
  }
}

client.login(process.env.DISCORD_TOKEN);
