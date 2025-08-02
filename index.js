console.log("Starting bot script...");

require("dotenv").config();
const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});

const USER_GROUPS = [
  { label: "Campaign Team", value: "campaign-team" },
  { label: "Digital Marketing Team", value: "digital-marketing-team" },
  { label: "Editorial Team", value: "editorial-team" },
  { label: "Finance Team", value: "finance-team" },
  { label: "Networking Team", value: "networking-team" },
  { label: "Technology Team", value: "tech-team" },
];

const TEST_CHANNEL_ID = "C06BS22N3D3";
const ADMIN_CHANNEL_ID = "C07DPHN9PG9";

app.event("member_joined_channel", async ({ event, client }) => {
  try {
    if (event.channel === TEST_CHANNEL_ID) {
      await client.views.open({
        trigger_id: event.trigger_id,
        user_id: event.user,
        view: {
          type: "modal",
          callback_id: "team_select_modal",
          title: { type: "plain_text", text: "Welcome to TEDI!" },
          submit: { type: "plain_text", text: "Submit" },
          close: { type: "plain_text", text: "Cancel" },
          blocks: [
            {
              type: "input",
              block_id: "team_input",
              label: {
                type: "plain_text",
                text: "Which team are you part of?",
              },
              element: {
                type: "static_select",
                action_id: "team_selected",
                placeholder: { type: "plain_text", text: "Select a team" },
                options: USER_GROUPS.map((team) => ({
                  text: { type: "plain_text", text: team.label },
                  value: team.value,
                })),
              },
            },
          ],
        },
      });
    }
  } catch (error) {
    console.error("Error opening modal:", error);
  }
});

app.view("team_select_modal", async ({ ack, body, view, client }) => {
  await ack();

  const user = body.user.id;
  const selectedTeam =
    view.state.values.team_input.team_selected.selected_option.value;

  await client.chat.postMessage({
    channel: ADMIN_CHANNEL_ID,
    text: `<@${user}> has joined TEDI, team: *${selectedTeam}*`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<@${user}> has joined TEDI, team: *${selectedTeam}*`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Accept Role" },
            style: "primary",
            value: JSON.stringify({ user, team: selectedTeam }),
            action_id: "approve_user",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Decline Role" },
            style: "danger",
            value: JSON.stringify({ user, team: selectedTeam }),
            action_id: "decline_user",
          },
        ],
      },
    ],
  });

  await client.chat.postMessage({
    channel: user,
    text: `Thanks for selecting your team: *${selectedTeam}*. Waiting for admin approval.`,
  });
});

app.action("approve_user", async ({ ack, body, client }) => {
  await ack();

  const { user, team } = JSON.parse(body.actions[0].value);

  try {
    const groupsRes = await client.usergroups.list();
    const group = groupsRes.usergroups.find((g) => g.handle === team);

    if (!group) {
      await client.chat.postMessage({
        channel: body.channel.id,
        text: `User group *${team}* not found.`,
      });
      return;
    }

    const usersRes = await client.usergroups.users.list({
      usergroup: group.id,
    });
    let users = usersRes.users || [];

    if (!users.includes(user)) users.push(user);

    await client.usergroups.users.update({
      usergroup: group.id,
      users: users.join(","),
    });

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `<@${user}> was accepted and added to *${group.name}*.`,
      blocks: [],
    });

    await client.chat.postMessage({
      channel: user,
      text: `You have been added to *${group.name}*. Welcome aboard!`,
    });
  } catch (error) {
    console.error(error);
  }
});

app.action("decline_user", async ({ ack, body, client }) => {
  await ack();

  const { user, team } = JSON.parse(body.actions[0].value);

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `<@${user}>'s request to join *${team}* was declined.`,
    blocks: [],
  });

  await client.chat.postMessage({
    channel: user,
    text: `Your request to join *${team}* was declined by the admins.`,
  });
});

// Start the app
(async () => {
  await app.start();
  console.log("⚡️ Slack TEDI Role Bot is running!");
})();
