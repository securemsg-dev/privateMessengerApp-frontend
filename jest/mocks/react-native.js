module.exports = {
  Platform: { OS: 'ios', select: (obj) => obj.ios ?? obj.default },
  Alert: { alert: jest.fn() },
};
