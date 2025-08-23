const { DateTime } = require('luxon');

// Returns 'Jackpot' on Fridays in Australia/Sydney, else 'Standard'
function desiredModeNow() {
  const now = DateTime.now().setZone('Australia/Sydney');
  return now.weekday === 5 ? 'Jackpot' : 'Standard'; // 5 = Friday
}

module.exports = { desiredModeNow };
