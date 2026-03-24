const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Groq = require('groq-sdk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `Tu es un assistant expert en achat-revente sur Vinted. Tu aides à :
- Estimer si un article est une bonne affaire à acheter pour revendre
- Rédiger des annonces attractives pour Vinted
- Calculer les marges bénéficiaires
- Suggérer des prix de revente optimaux
- Identifier les marques/articles qui se revendent bien

Réponds toujours en français, de façon concise et pratique.
Quand tu calcules une marge, affiche clairement : Prix achat / Prix revente conseillé / Frais estimés / Bénéfice net.
Utilise des emojis pour rendre tes réponses plus lisibles sur Discord.`;

const COMMANDS = {
  '!aide': sendHelp,
  '!annonce': generateAnnonce,
  '!marge': calculerMarge,
  '!analyse': analyserArticle,
  '!prix': suggererPrix,
};

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
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
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
    });
    await message.reply(response.choices[0].message.content);
  } catch (err) {
    await message.reply('❌ Erreur. Réessaie dans un moment.');
    console.error(err);
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
    .setFooter({ text: 'Powered by Groq AI' });
  await message.reply({ embeds: [embed] });
}

async function generateAnnonce(message, content) {
  const description = content.replace('!annonce', '').trim();
  if (!description) return message.reply('❌ Usage : `!annonce [description de l\'article]`');
  await message.channel.sendTyping();
  const response = await callGroq(`Génère une annonce Vinted complète et attractive pour : "${description}". Inclus : titre accrocheur, description détaillée, état, conseil de prix.`);
  await message.reply(response);
}

async function calculerMarge(message, content) {
  const parts = content.split(' ').filter(Boolean);
  const prixAchat = parseFloat(parts[1]);
  const prixRevente = parseFloat(parts[2]);
  if (isNaN(prixAchat) || isNaN(prixRevente)) return message.reply('❌ Usage : `!marge [prix achat] [prix revente]`\nExemple : `!marge 15 35`');
  const fraisLivraison = 4.5;
  const beneficeNet = prixRevente - prixAchat - fraisLivraison;
  const marge = ((beneficeNet / prixAchat) * 100).toFixed(0);
  const rentable = beneficeNet > 0;
  const embed = new EmbedBuilder()
    .setColor(rentable ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${rentable ? '✅' : '❌'} Analyse de marge`)
    .addFields(
      { name: '💸 Prix d\'achat', value: `${prixAchat.toFixed(2)} €`, inline: true },
      { name: '🏷️ Prix de revente', value: `${prixRevente.toFixed(2)} €`, inline: true },
      { name: '📦 Frais livraison estimés', value: `${fraisLivraison.toFixed(2)} €`, inline: true },
      { name: '💰 Bénéfice net estimé', value: `**${beneficeNet.toFixed(2)} €**`, inline: true },
      { name: '📈 Taux de marge', value: `**${marge}%**`, inline: true },
    )
    .setFooter({ text: 'Frais Vinted acheteur (5% + 0,70€) à la charge de l\'acheteur' });
  await message.reply({ embeds: [embed] });
}

async function analyserArticle(message, content) {
  const description = content.replace('!analyse', '').trim();
  if (!description) return message.reply('❌ Usage : `!analyse [description + prix]`');
  await message.channel.sendTyping();
  const response = await callGroq(`Analyse cet article Vinted pour un acheteur-revendeur : "${description}". Dis-moi : 1) Si c'est une bonne affaire, 2) Le potentiel de revente, 3) Le prix de revente conseillé, 4) Les risques éventuels.`);
  await message.reply(response);
}

async function suggererPrix(message, content) {
  const description = content.replace('!prix', '').trim();
  if (!description) return message.reply('❌ Usage : `!prix [marque] [article] [état]`');
  await message.channel.sendTyping();
  const response = await callGroq(`Pour cet article Vinted : "${description}", donne-moi : 1) Le prix idéal pour vendre rapidement, 2) Le prix maximum possible, 3) Les mots-clés pour l'annonce, 4) Astuces pour maximiser la vente.`);
  await message.reply(response);
}

async function callGroq(userPrompt) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
    });
    return response.choices[0].message.content;
  } catch (err) {
    console.error('Erreur Groq:', err);
    return '❌ Erreur. Réessaie dans un moment.';
  }
}

client.login(process.env.DISCORD_TOKEN);
