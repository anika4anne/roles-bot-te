require("dotenv").config();
const { App, AwsLambdaReceiver } = require("@slack/bolt");

const receiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

const USER_GROUPS = [
  { label: "Campaign Team", value: "campaign-team" },
  { label: "Digital Marketing Team", value: "digital-marketing-team" },
  { label: "Editorial Team", value: "editorial-team" },
  { label: "Finance Team", value: "finance-team" },
  { label: "Networking Team", value: "networking-team" },
  { label: "Technology Team", value: "tech-team" },
];

const ADMIN_CHANNEL_ID = "C07DPHN9PG9";
const EXCLUDED_USER_ID = "U06BNANNLA2";

async function checkForUnassignedUsers(client) {
  try {
    const usersRes = await client.users.list();
    const allUsers = usersRes.members.filter(
      (u) => !u.is_bot && u.id !== "USLACKBOT" && u.id !== EXCLUDED_USER_ID
    );

    const groupsRes = await client.usergroups.list();
    const allGroups = groupsRes.usergroups;

    let allAssignedUserIds = new Set();
    for (let group of allGroups) {
      const usersRes = await client.usergroups.users.list({
        usergroup: group.id,
      });
      (usersRes.users || []).forEach((u) => allAssignedUserIds.add(u));
    }

    const unassigned = allUsers.filter((u) => !allAssignedUserIds.has(u.id));

    for (let user of unassigned) {
      await client.chat.postMessage({
        channel: user.id,
        text: `Hi <@${user.id}>, you haven't selected your team yet. Please set your role.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hi <@${user.id}>, you haven't selected your team yet. Please set your role.`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Set My Team" },
                style: "primary",
                value: user.id,
                action_id: "open_team_modal",
              },
            ],
          },
        ],
      });
    }
  } catch (error) {
    console.error("Error checking unassigned users:", error);
  }
}

app.action("open_team_modal", async ({ ack, body, client }) => {
  await ack();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "team_select_modal",
      title: { type: "plain_text", text: "Set Your Team" },
      submit: { type: "plain_text", text: "Submit" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "team_input",
          label: { type: "plain_text", text: "Which team are you part of?" },
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
});

app.view("team_select_modal", async ({ ack, body, view, client }) => {
  await ack();

  const user = body.user.id;
  const selectedTeam =
    view.state.values.team_input.team_selected.selected_option.value;

  await client.chat.postMessage({
    channel: ADMIN_CHANNEL_ID,
    text: `<@${user}> wants to join team: *${selectedTeam}*`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<@${user}> wants to join team: *${selectedTeam}*`,
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

exports.handler = async (event, context) => {
  if (event.headers && event.body) {
    return await receiver.start()(event, context);
  }

  if (event.source === "aws.events") {
    try {
      await checkForUnassignedUsers(app.client);
      return { statusCode: 200, body: "Checked unassigned users" };
    } catch (error) {
      console.error(error);
      return { statusCode: 500, body: "Error checking users" };
    }
  }

  return { statusCode: 400, body: "Unsupported event" };
};
