// Simple test to verify command adaptation works on Windows
console.log('Testing command adaptation on Windows...');

// Mock the command adaptation logic directly
const COMMAND_MAP = {
  ls: { cmd: "dir", useShell: true },
  cat: { cmd: "type", useShell: true },
  echo: { cmd: "echo", useShell: true },
};

function adaptCommandForPlatform(command) {
  if (process.platform !== "win32") {
    return command;
  }

  if (command.length === 0) {
    return command;
  }

  const cmd = command[0]?.trim();
  if (!cmd || cmd === "$" || cmd === ">" || cmd === "#") {
    return command;
  }

  const commandMapping = COMMAND_MAP[cmd];
  if (!commandMapping) {
    return command;
  }

  console.log(`Adapting command '${cmd}' for Windows platform`);

  let adaptedCommand = [...command];
  adaptedCommand[0] = commandMapping.cmd;

  if (commandMapping.useShell) {
    adaptedCommand = ["cmd.exe", "/c", ...adaptedCommand];
  }

  console.log(`Adapted command: ${adaptedCommand.join(" ")}`);
  return adaptedCommand;
}

// Test cases
console.log('Original ls:', JSON.stringify(['ls']));
console.log('Adapted ls:', JSON.stringify(adaptCommandForPlatform(['ls'])));

console.log('Original cat file.txt:', JSON.stringify(['cat', 'file.txt']));
console.log('Adapted cat file.txt:', JSON.stringify(adaptCommandForPlatform(['cat', 'file.txt'])));

console.log('Original echo hello:', JSON.stringify(['echo', 'hello']));
console.log('Adapted echo hello:', JSON.stringify(adaptCommandForPlatform(['echo', 'hello']))); 