export const getWaitingRatePerMinute = (tariff?: Record<string, any> | null): number => {
  if (!tariff) {
    return 0;
  }

  const candidateKeys = [
    'waitingTimeRate',
    'waiting_time_rate',
    'waitingRate',
    'waiting_rate',
    'waitingFee',
    'waiting_fee',
    'waitingFeePerMinute',
    'waiting_fee_per_minute',
    'waitingPerMinuteRate',
    'waiting_per_minute_rate',
    'waitingCost',
    'waiting_cost',
    'waitingCharges',
    'waiting_charges',
    'waitingCharge',
    'waiting_charge',
  ];

  for (const key of candidateKeys) {
    if (tariff[key] === undefined || tariff[key] === null) {
      continue;
    }

    const value = Number(tariff[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
};
