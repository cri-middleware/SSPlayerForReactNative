module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // Must stay last. Reanimated 4 ships its worklet transform through
    // react-native-worklets; Skia 2.x requires Reanimated 4+, so this is not
    // optional even though the spike drives its clock from the JS thread.
    plugins: ['react-native-worklets/plugin'],
  }
}
