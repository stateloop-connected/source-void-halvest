const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    return {
        mode: isProduction ? 'production' : 'development',
        entry: './js/main.js',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: isProduction ? 'game.[contenthash:8].js' : 'game.js',
            clean: true,
        },
        module: {
            rules: [
                {
                    test: /\.css$/,
                    use: [
                        isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
                        'css-loader'
                    ],
                },
                {
                    test: /\.scss$/,
                    use: [
                        isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
                        'css-loader',
                        'sass-loader'
                    ],
                },
            ],
        },
        resolve: {
            // @colyseus/sdk only uses `ws` when the browser has no WebSocket
            fallback: { ws: false },
        },
        plugins: [
            // Online co-op server address. The Creator platform passes
            // browser configuration keys as build environment variables.
            new webpack.DefinePlugin({
                __COOP_SERVER_URL__: JSON.stringify(process.env.COOP_SERVER_URL || ''),
            }),
            new HtmlWebpackPlugin({
                template: './index.html',
                inject: 'body',
            }),
            ...(isProduction ? [
                new MiniCssExtractPlugin({
                    filename: 'styles.[contenthash:8].css',
                }),
            ] : []),
        ],
        devtool: isProduction ? 'source-map' : 'eval-source-map',
        devServer: {
            static: false, // Serve from memory, not from disk
            port: 3000,
            open: true,
            hot: true,
            compress: true,
            devMiddleware: {
                writeToDisk: false, // Don't write files to disk in dev mode
            },
        },
    };
};
