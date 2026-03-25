const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Groq = require('groq-sdk');
const https = require('https');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const CHANNEL_ID = process.env.CHANNEL_ID;

const SYSTEM_PROMPT = `Tu es un assistant expert en achat-revente sur Vinted. Tu aides à estimer si un article est une bonne affaire, rédiger des annonces, calculer les marges et suggérer des prix. Réponds toujours en français, de façon concise. Utilise des emojis.`;

const SALONS = {
  'Nike': '1486187831213822074',
  'Adidas': '1486187831213822074',
  'Jordan': '1486187831213822074',
  'New Balance': '1486187831213822074',
  'Lacoste': '1486187881847455865',
  'Ralph Lauren': '1486187881847455865',
  'Tommy Hilfiger': '1486187881847455865',
  'Levis': '1486187881847455865',
  'Carhartt': '1486187881847455865',
  'Stone Island': '1486187939565404252',
  'CP Company': '1486187939565404252',
  'Moncler': '1486187939565404252',
  'Burberry': '1486187939565404252',
  'The North Face': '1486187939565404252',
  'Palace': '1486187939565404252'
};

const MARQUES = Object.keys(SALONS);
const articlesVus = new Set();
let scraperInitialise = false;

function fetchVinted(marque) {
  return new Promise(function(resolve) {
    const query = encodeURIComponent(marque);
    const options = {
      hostname: 'www.vinted.fr',
      path: '/api/v2/catalog/items?search_text=' + query + '&per_page=20&order=newest_first',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      }
    };
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data).items || []); }
        catch(e) { resolve([]); }
      });
    });
    req.on('error', function() { resolve([]); });
    req.setTimeout(10000, function() { req.destroy(); resolve([]); });
    req.end();
  });
}

async function scannerVinted() {
  if (!CHANNEL_ID) return;
  for (let i = 0; i < MARQUES.length; i++) {
    const marque = MARQUES[i];
    try {
      const articles = await fetchVinted(marque);
      for (let j = 0; j < articles.length; j++) {
        const article = articles[j];
        const id = String(article.id || '');
        if (!id || articlesVus.has(id)) continue;
        articlesVus.add(id);
        if (!scraperInitialise) continue;
        const channelId = SALONS[marque] || CHANNEL_ID;
        const channel = client.channels.cache.get(channelId);
        if (!channel) continue;
        const prix = article.price ? article.price + ' EUR' : 'Prix inconnu';
        const taille = article.size_title || 'Non precisee';
        const etat = article.status || 'Non precise';
        const lien = 'https://www.vinted.fr/items/' + id;
        const embed = new EmbedBuilder()
          .setColor(0x09B1BA)
          .setTitle('Nouvelle annonce - ' + (article.title || marque))
          .addFields(
            { name: 'Prix', value: prix, inline: true },
            { name: 'Taille', value: taille, inline: true },
            { name: 'Etat', value: etat, inline: true },
            { name: 'Lien', value: lien }
          )
          .setFooter({ text: 'Marque : ' + marque });
        if (article.photos && article.photos[0] && article.photos[0].url) {
          embed.setThumbnail(article.photos[0].url);
        }
        await channel.send({ embeds: [embed] });
      }
      await new Promise(function(r) { setTimeout(r, 2000); });
    } catch(err) {
      console.error('Erreur scraping ' + marque + ':', err.message);
    }
  }
}

const COMMANDS = {
  '!aide': sendHelp,
  '!annonce': generateAnnonce,
  '!marge': calculerMarge,
  '!analyse': analyserArticle,
  '!prix': suggererPrix
};

client.once('ready', async function() {
  console.log('Bot connecte : ' + client.user.tag);
  const results = await Promise.all(MARQUES.map(function(m) { return fetchVinted(m); }));
  results.forEach(function(items) {
    items.forEach(function(a) { if (a.id) articlesVus.add(String(a.id)); });
  });
  scraperInitialise = true;
  console.log(articlesVus.size + ' articles existants ignores. Surveillance active !');
  setInterval(scannerVinted, 2 * 60 * 1000);
});

client.on('messageCreate', async function(message) {
  if (message.author.bot) return;
  const content = message.content.trim();
  const prefix = content.split(' ')[0].toLowerCase();
  if (COMMANDS[prefix]) {
    await COMMANDS[prefix](message, content);
    return;
  }
  if (message.mentions.has(client.user)) {
    const userMessage = content.replace('<@' + client.user.id + '>', '').trim();
    await repondreLibrement(message, userMessage);
  }
});

async function repondreLibrement(message, userMessage) {
  await message.channel.sendTyping();
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ]
    });
    await message.reply(response.choices[0].message.content);
  } catch(err) {
    await message.reply('Erreur. Reessaie dans un moment.');
  }
}

async function sendHelp(message) {
  const embed = new EmbedBuilder()
    .setColor(0x09B1BA)
    .setTitle('Bot Vinted - Commandes disponibles')
    .addFields(
      { name: '!annonce [description]', value: 'Genere une annonce Vinted attractive' },
      { name: '!marge [prix achat] [prix revente]', value: 'Calcule ta marge nette' },
      { name: '!analyse [description article]', value: 'Evalue si c est une bonne affaire' },
      { name: '!prix [marque] [article] [etat]', value: 'Suggere un prix de revente' },
      { name: '@Bot [question]', value: 'Pose une question libre' }
    )
    .setFooter({ text: 'Powered by Groq AI' });
  await message.reply({ embeds: [embed] });
}

async function generateAnnonce(message, content) {
  const description = content.replace('!annonce', '').trim();
  if (!description) return message.reply('Usage : !annonce [description]');
  await message.channel.sendTyping();
  const response = await callGroq('Genere une annonce Vinted complete pour : "' + description + '". Inclus titre, description, etat, prix conseille.');
  await message.reply(response);
}

async function calculerMarge(message, content) {
  const parts = content.split(' ').filter(Boolean);
  const prixAchat = parseFloat(parts[1]);
  const prixRevente = parseFloat(parts[2]);
  if (isNaN(prixAchat) || isNaN(prixRevente)) return message.reply('Usage : !marge [prix achat] [prix revente]');
  const fraisLivraison = 4.5;
  const beneficeNet = prixRevente - prixAchat - fraisLivraison;
  const marge = ((beneficeNet / prixAchat) * 100).toFixed(0);
  const embed = new EmbedBuilder()
    .setColor(beneficeNet > 0 ? 0x2ecc71 : 0xe74c3c)
    .setTitle((beneficeNet > 0 ? 'Bonne affaire' : 'Mauvaise affaire') + ' - Analyse de marge')
    .addFields(
      { name: 'Prix achat', value: prixAchat.toFixed(2) + ' EUR', inline: true },
      { name: 'Prix revente', value: prixRevente.toFixed(2) + ' EUR', inline: true },
      { name: 'Frais livraison', value: fraisLivraison.toFixed(2) + ' EUR', inline: true },
      { name: 'Benefice net', value: beneficeNet.toFixed(2) + ' EUR', inline: true },
      { name: 'Taux de marge', value: marge + '%', inline: true }
    );
  await message.reply({ embeds: [embed] });
}

async function analyserArticle(message, content) {
  const description = content.replace('!analyse', '').trim();
  if (!description) return message.reply('Usage : !analyse [description + prix]');
  await message.channel.sendTyping();
  const response = await callGroq('Analyse cet article Vinted pour un acheteur-revendeur : "' + description + '". Dis-moi si c est une bonne affaire, le potentiel de revente, le prix conseille et les risques.');
  await message.reply(response);
}

async function suggererPrix(message, content) {
  const description = content.replace('!prix', '').trim();
  if (!description) return message.reply('Usage : !prix [marque] [article] [etat]');
  await message.channel.sendTyping();
  const response = await callGroq('Pour cet article Vinted : "' + description + '", donne le prix ideal de revente, le prix maximum, les mots-cles pour l annonce et des astuces.');
  await message.reply(response);
}

async function callGroq(userPrompt) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    });
    return response.choices[0].message.content;
  } catch(err) {
    return 'Erreur. Reessaie dans un moment.';
  }
}

client.login(process.env.DISCORD_TOKEN);
