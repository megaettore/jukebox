/* eslint-disable block-scoped-var, @typescript-eslint/restrict-template-expressions */
import { BaseCommand } from "../structures/BaseCommand";
import { ServerQueue } from "../structures/ServerQueue";
import { playMusic } from "../utils/YouTubeDownload";
import { Util, MessageEmbed, VoiceChannel } from "discord.js";
import { decodeHTML } from "entities";
import { IMessage, ISong, IGuild, ITextChannel } from "../../typings";
import { Video } from "../utils/YoutubeAPI/structures/Video";
import { DefineCommand } from "../utils/decorators/DefineCommand";
import { isUserInTheVoiceChannel, isSameVoiceChannel, isValidVoiceChannel } from "../utils/decorators/MusicHelper";
import { createEmbed } from "../utils/createEmbed";

@DefineCommand({
    aliases: ["play-music", "add", "p"],
    name: "play",
    description: "Play some music",
    usage: "{prefix}play <yt video or playlist link / yt video name>"
})
export class PlayCommand extends BaseCommand {
    @isUserInTheVoiceChannel()
    @isValidVoiceChannel()
    @isSameVoiceChannel()
    public async execute(message: IMessage, args: string[]): Promise<any> {
        const voiceChannel = message.member!.voice.channel!;
        if (!args[0]) {
            return message.channel.send(
                createEmbed("warn", `Qualcosa è andato storto, digita \`${this.client.config.prefix}help play\` per ulteriori info`)
            );
        }
        const searchString = args.join(" ");
        const url = searchString.replace(/<(.+)>/g, "$1");

        if (message.guild?.queue !== null && voiceChannel.id !== message.guild?.queue.voiceChannel?.id) {
            return message.channel.send(
                createEmbed("warn", `Il bot è già utilizzato nel canale vocale **${message.guild?.queue.voiceChannel?.name}**`)
            );
        }

        if (/^https?:\/\/(www\.youtube\.com|youtube.com)\/playlist(.*)$/.exec(url)) {
            try {
                const id = new URL(url).searchParams.get("list")!;
                const playlist = await this.client.youtube.getPlaylist(id);
                const videos = await playlist.getVideos();
                let skippedVideos = 0;
                message.channel.send(createEmbed("info", `Aggiunta la playlist in coda: **[${playlist.title}](${playlist.url})**, ...`))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                for (const video of Object.values(videos)) {
                    if (video.status.privacyStatus === "private") {
                        skippedVideos++;
                        continue;
                    } else {
                        const video2 = await this.client.youtube.getVideo(video.id);
                        await this.handleVideo(video2, message, voiceChannel, true);
                    }
                }
                if (skippedVideos !== 0) {
                    message.channel.send(
                        createEmbed("warn", `${skippedVideos} ${skippedVideos >= 2 ? `videos` : `video`} categorizzato come privato, non è possibile eseguire l'ascolto`)
                    ).catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                }
                if (skippedVideos === playlist.itemCount) return message.channel.send(createEmbed("error", `Errore nel caricamento della playlist **[${playlist.title}](${playlist.url})** because all of the items are private videos`));
                return message.channel.send(createEmbed("info", `Tutti i video della playlist: **[${playlist.title}](${playlist.url})**, sono stati aggiunti alla coda!`));
            } catch (e) {
                this.client.logger.error("YT_PLAYLIST_ERR:", new Error(e.message));
                return message.channel.send(createEmbed("error", `Non riesco a caricare la playlist playlist!\nError: \`${e.message}\``));
            }
        }
        try {
            const id = new URL(url).searchParams.get("v")!;
            // eslint-disable-next-line no-var, block-scoped-var
            var video = await this.client.youtube.getVideo(id);
        } catch (e) {
            try {
                const videos = await this.client.youtube.searchVideos(searchString, this.client.config.searchMaxResults);
                if (videos.length === 0) return message.channel.send(createEmbed("warn", "Non trovo nessun risultato inerente!"));
                if (this.client.config.disableSongSelection) { video = await this.client.youtube.getVideo(videos[0].id); } else {
                    let index = 0;
                    const msg = await message.channel.send(new MessageEmbed()
                        .setAuthor("Music Selection")
                        .setDescription(`${videos.map(video => `**${++index} -** ${this.cleanTitle(video.title)}`).join("\n")}\n` +
                        "*Type `cancel` or `c` to cancel music selection*")
                        .setThumbnail(message.client.user?.displayAvatarURL() as string)
                        .setColor("#00FF00")
                        .setFooter("Seleziona la canzone tra i risultati ottenuto inviando un numero da 1 a 12"));
                    try {
                    // eslint-disable-next-line no-var
                        var response = await message.channel.awaitMessages((msg2: IMessage) => {
                            if (message.author.id !== msg2.author.id) return false;

                            if (msg2.content === "cancel" || msg2.content === "c") return true;
                            return Number(msg2.content) > 0 && Number(msg2.content) < 13;
                        }, {
                            max: 1,
                            time: this.client.config.selectTimeout,
                            errors: ["time"]
                        });
                        msg.delete().catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                        response.first()?.delete({ timeout: 3000 }).catch(e => e); // do nothing
                    } catch (error) {
                        msg.delete().catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                        return message.channel.send(createEmbed("error", "Non è stato inviato un numero o è stato inviato errato, la selezione è stata rimossa."));
                    }
                    if (response.first()?.content === "c" || response.first()?.content === "cancel") {
                        return message.channel.send(createEmbed("info", "La selezione è stata rimossa."));
                    }
                    const videoIndex = parseInt(response.first()?.content as string, 10);
                    video = await this.client.youtube.getVideo(videos[videoIndex - 1].id);
                }
            } catch (err) {
                this.client.logger.error("YT_SEARCH_ERR:", err);
                return message.channel.send(createEmbed("error", `Non trovo nessun risultato inerente!\nError: \`${err.message}\``));
            }
        }
        return this.handleVideo(video, message, voiceChannel);
    }

    private async handleVideo(video: Video, message: IMessage, voiceChannel: VoiceChannel, playlist = false): Promise<any> {
        const song: ISong = {
            id: video.id,
            title: this.cleanTitle(video.title),
            url: video.url,
            thumbnail: video.thumbnailURL
        };
        if (message.guild?.queue) {
            if (!this.client.config.allowDuplicate && message.guild.queue.songs.find(s => s.id === song.id)) {
                return message.channel.send(
                    createEmbed("warn", `La canzone **[${song.title}](${song.id})** è già in coda, questo bot è configurato per non duplicare canzoni già aggiunte, ` +
                `in questo caso digita \`${this.client.config.prefix}repeat\` piuttosto`)
                        .setTitle("Already queued")
                );
            }
            message.guild.queue.songs.addSong(song);
            if (playlist) return;
            message.channel.send(createEmbed("info", `✅ La anzone **[${song.title}](${song.url})** è stata aggiunta alla coda`).setThumbnail(song.thumbnail))
                .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
        } else {
            message.guild!.queue = new ServerQueue(message.channel as ITextChannel, voiceChannel);
            message.guild?.queue.songs.addSong(song);
            try {
                const connection = await message.guild!.queue.voiceChannel!.join();
                message.guild!.queue.connection = connection;
            } catch (error) {
                message.guild?.queue.songs.clear();
                message.guild!.queue = null;
                this.client.logger.error("PLAY_CMD_ERR:", error);
                message.channel.send(createEmbed("error", `Errore: Non riesco ad accedere al canale vocale!\nReason: \`${error.message}\``))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                return undefined;
            }
            this.play(message.guild!).catch(err => {
                message.channel.send(createEmbed("error", `Errore durante la riproduzione\nReason: \`${err.message}\``))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                return this.client.logger.error("PLAY_CMD_ERR:", err);
            });
        }
        return message;
    }

    private async play(guild: IGuild): Promise<any> {
        const serverQueue = guild.queue!;
        const song = serverQueue.songs.first();
        if (!song) {
            serverQueue.textChannel?.send(
                createEmbed("info", `⏹ Nessuna canzone in coda! Digita "${guild.client.config.prefix}play" per ascoltare nuove canzoni`)
            ).catch(e => this.client.logger.error("PLAY_ERR:", e));
            serverQueue.connection?.disconnect();
            return guild.queue = null;
        }

        serverQueue.connection?.voice?.setSelfDeaf(true).catch(e => this.client.logger.error("PLAY_ERR:", e));
        const songData = await playMusic(song.url, { cache: this.client.config.cacheYoutubeDownloads, cacheMaxLength: this.client.config.cacheMaxLengthAllowed, skipFFmpeg: true });

        if (songData.cache) this.client.logger.info(`${this.client.shard ? `[Shard #${this.client.shard.ids}]` : ""} Sto utilizzando la cache per la canzone "${song.title}" su ${guild.name}`);

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        songData.on("error", err => { err.message = `YTDLError: ${err.message}`; serverQueue.connection?.dispatcher?.emit("error", err); });

        serverQueue.connection?.play(songData, { type: songData.info.canSkipFFmpeg ? "webm/opus" : "unknown", bitrate: "auto", highWaterMark: 1 })
            .on("start", () => {
                serverQueue.playing = true;
                this.client.logger.info(`${this.client.shard ? `[Shard #${this.client.shard.ids}]` : ""} Song: "${song.title}" on ${guild.name} started`);
                if (serverQueue.lastMusicMessageID !== null) serverQueue.textChannel?.messages.fetch(serverQueue.lastMusicMessageID, false).then(m => m.delete()).catch(e => this.client.logger.error("PLAY_ERR:", e));
                serverQueue.textChannel?.send(createEmbed("info", `▶ Start playing: **[${song.title}](${song.url})**`).setThumbnail(song.thumbnail))
                    .then(m => serverQueue.lastMusicMessageID = m.id)
                    .catch(e => this.client.logger.error("PLAY_ERR:", e));
            })
            .on("finish", () => {
                this.client.logger.info(`${this.client.shard ? `[Shard #${this.client.shard.ids}]` : ""} Song: "${song.title}" on ${guild.name} ended`);
                // eslint-disable-next-line max-statements-per-line
                if (serverQueue.loopMode === 0) { serverQueue.songs.deleteFirst(); } else if (serverQueue.loopMode === 2) { serverQueue.songs.deleteFirst(); serverQueue.songs.addSong(song); }
                if (serverQueue.lastMusicMessageID !== null) serverQueue.textChannel?.messages.fetch(serverQueue.lastMusicMessageID, false).then(m => m.delete()).catch(e => this.client.logger.error("PLAY_ERR:", e));
                serverQueue.textChannel?.send(createEmbed("info", `⏹ Stop playing: **[${song.title}](${song.url})**`).setThumbnail(song.thumbnail))
                    .then(m => serverQueue.lastMusicMessageID = m.id)
                    .catch(e => this.client.logger.error("PLAY_ERR:", e));
                this.play(guild).catch(e => {
                    serverQueue.textChannel?.send(createEmbed("error", `Errore nel tentativo di riproduzione\nReason: \`${e}\``))
                        .catch(e => this.client.logger.error("PLAY_ERR:", e));
                    serverQueue.connection?.dispatcher.end();
                    return this.client.logger.error("PLAY_ERR:", e);
                });
            })
            .on("error", (err: Error) => {
                serverQueue.textChannel?.send(createEmbed("error", `Errore durante l'ascolto della canzone\nReason: \`${err.message}\``))
                    .catch(e => this.client.logger.error("PLAY_CMD_ERR:", e));
                guild.queue?.voiceChannel?.leave();
                guild.queue = null;
                this.client.logger.error("PLAY_ERR:", err);
            })
            .setVolume(serverQueue.volume / guild.client.config.maxVolume);
    }

    private cleanTitle(title: string): string {
        return Util.escapeMarkdown(decodeHTML(title));
    }
}
