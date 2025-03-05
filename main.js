const { Client, Intents, MessageActionRow, MessageButton } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const Tesseract = require("tesseract.js");
const fs = require("fs");
const { translate } = require('bing-translate-api');
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.DIRECT_MESSAGES, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.DIRECT_MESSAGE_TYPING] });

const config = require('./config.json');
const adminRole = config.adminRole;
const categoryToCheck = config.categoryToCheck;
const mainLang = config.mainLang;
client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

const commands = [
  {
    name: 'add-ifm',
    description: 'Add an issue with its fix and image to the data.json',
    options: [
      {
        name: 'issue',
        type: 3,
        description: 'The issue description',
        required: true,
      },
      {
        name: 'fix',
        type: 3,
        description: 'The fix for the issue',
        required: true,
      },
      {
        name: 'img',
        type: 3,
        description: 'Image URL for fix (optional)',
        required: false,
      },
    ],
  },
  {
    name: 'setlang',
    description: 'Set the main language for the bot',
    options: [
      {
        name: 'lang',
        type: 3,
        description: 'The language code to set as the main language',
        required: true,
      }
    ],
  }
];

const rest = new REST({ version: '9' }).setToken(config.token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content) return;
  
    const channel = message.channel;
    const category = channel.parent;
  
    if (!category || category.name !== categoryToCheck) return;
  
    let content = message.content.toLowerCase();
  
    if (message.attachments.size > 0) {
      message.attachments.forEach(async (attachment) => {
        var ImageURL = attachment.url;
        try {
          const { data: { text } } = await Tesseract.recognize(
            ImageURL,
            config.languages,
            // { logger: (m) => console.log(m) }
          );
          content = text.toLowerCase();
          alignAndSendFix(message, content);
        } catch (error) {
          console.error("An error occurred while running OCR:", error);
        }
      });
    } else {
      alignAndSendFix(message, content);
    }
});  

async function detectLanguage(message) {
  try {
    const text = message.content.trim();
    if (!text) return null;
    const result = await translate(text, null, mainLang);
    return result.language.from;
  } catch (error) {
    console.error("An error occurred while detecting language:", error);
    return null;
  }
}

async function alignAndSendFix(message, content) {
  try {
    const detectedLang = await detectLanguage(message);
    if (detectedLang && detectedLang !== mainLang) {
      const translationResult = await translate(content, null, mainLang);
      content = translationResult.translation.toLowerCase();
    }
    await searchAndSendFix(message, content);
  } catch (error) {
    console.error("An error occurred while aligning with the main language:", error);
  }
}

async function searchAndSendFix(message, content) {
    try {
      const data = fs.readFileSync("data.json", "utf8");
      const jsonData = JSON.parse(data);
      const fixData = jsonData.find((entry) => content.includes(entry.issue.toLowerCase()));
      if (fixData) {
        let reply = `**Issue:** ${fixData.issue}\n**How to Fix:** ${fixData.fix}`;
        if (fixData.img) {
          reply += `\n${fixData.img}`;
        }
  
        const row = new MessageActionRow()
          .addComponents(
            new MessageButton()
              .setCustomId('issue_solved')
              .setLabel('Issue Resolved')
              .setStyle('SUCCESS'),
            new MessageButton()
              .setCustomId('issue_unresolved')
              .setLabel('Issue Not Resolved, Notify Admin')
              .setStyle('DANGER'),
          );
  
        const replyMessage = await message.reply({ content: reply, components: [row] });
  
        const filter = i => i.customId === 'issue_solved' || i.customId === 'issue_unresolved';
        const collector = replyMessage.createMessageComponentCollector({ filter, time: 15000 });
  
        collector.on('collect', async interaction => {
          if (interaction.customId === 'issue_solved') {
            try {
              await interaction.update({ content: 'Im glad your issue is resolved! Have a nice day.', components: [] });
            } catch (error) {
              console.error('Error while updating interaction:', error);
            }
          } else if (interaction.customId === 'issue_unresolved') {
            await interaction.reply({ content: 'Issue not resolved, notifying admin...', ephemeral: true });
            const adminRoles = message.guild.roles.cache.get(adminRole);
            if (adminRoles) {
              await message.channel.send(`${adminRoles}, an issue has been reported by ${message.author}.`);
            } else {
              console.error('Admin role not found.');
            }
          }
        });            
        collector.on('end', () => {
          replyMessage.edit({ components: [] })
            .catch(console.error);
        });
      } else {
        message.reply("No solution found for the given issue.");
      }
    } catch (error) {
      console.error("An error occurred while searching for issues:", error);
    }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const command = interaction.commandName;
  const args = interaction.options;

  if (command === 'add-ifm') {
      if (!interaction.member.roles.cache.has(adminRole)) {
        return interaction.reply({ content: "**You don't have permission to use this command**", ephemeral: true });
      }

      const issue = args.get('issue').value;
      const fix = args.get('fix').value;
      const imgOption = args.get('img');
      const img = imgOption ? imgOption.value : "";

      let existingData;
      try {
        existingData = JSON.parse(fs.readFileSync("data.json", "utf8"));
      } catch (error) {
        existingData = [];
      }
      existingData.push({ issue, fix, img });
      fs.writeFileSync("data.json", JSON.stringify(existingData, null, 2));

      return interaction.reply({ content: '**Issue added successfully.**', ephemeral: true });
  } else if (command === 'setlang') {
    if (!interaction.member.roles.cache.has(adminRole)) {
      return interaction.reply({ content: "**You don't have permission to use this command**", ephemeral: true });
    }
    const newLang = interaction.options.getString('lang');
    if (!newLang) {
      return interaction.reply({ content: "Please provide a language code to set as the main language.", ephemeral: true });
    }
  
    config.mainLang = newLang;
    fs.writeFileSync('./config.json', JSON.stringify({ ...config, mainLang: newLang }, null, 2));
  
    return interaction.reply({ content: `Main language set to: ${newLang}`, ephemeral: true });
  }
});

client.login(config.token);