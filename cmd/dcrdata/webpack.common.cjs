const path = require('path')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const StyleLintPlugin = require('stylelint-webpack-plugin')
const { WebpackManifestPlugin } = require('webpack-manifest-plugin')

module.exports = {
  entry: {
    app: './public/index.js'
  },
  optimization: {
    chunkIds: 'natural',
    splitChunks: {
      chunks: 'all'
    }
  },
  target: 'web',
  module: {
    rules: [
      {
        test: /\.s?[ac]ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: false,
              // Fonts and images live in public/ and are served statically,
              // so we skip webpack asset processing for url() references.
              url: false,
              sourceMap: true
            }
          },
          {
            loader: 'sass-loader',
            options: {
              implementation: require('sass'), // dart-sass
              sourceMap: true
            }
          }
        ]
      }
    ]
  },
  plugins: [
    new CleanWebpackPlugin(),
    new MiniCssExtractPlugin({
      filename: 'css/style.[contenthash].css'
    }),
    new StyleLintPlugin({
      threads: true,
      allowEmptyInput: true // avoid errors when .stylelintignore excludes all files
    }),
    new WebpackManifestPlugin()
  ],
  output: {
    // xxhash64 is faster than the default md4 and supported on Node >= 18.
    hashFunction: 'xxhash64',
    filename: 'js/[name].[contenthash].bundle.js',
    path: path.resolve(__dirname, 'public/dist'),
    publicPath: '/dist/'
  },
  // Use a 1 s poll interval instead of the default 500 ms to reduce CPU usage
  // during watch mode. See https://github.com/webpack/webpack/issues/2297
  watchOptions: {
    poll: 1000
  }
}
