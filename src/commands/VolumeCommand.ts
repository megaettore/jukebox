import { BaseCommand } from "../structures/BaseCommand";
import { IMessage } from "../../typings";
import { DefineCommand } from "../utils/decorators/DefineCommand";
import { isUserInTheVoiceChannel, isMusicPlaying, isSameVoiceChannel } from "../utils/decorators/MusicHelper";
import { createEmbed } from "../utils/createEmbed";

@DefineCommand({
    aliases: ["vol"],
    name: "volume",
    description: "Show or change the music player's volume",
    usage: "{prefix}volume [new volume]"
})
export class VolumeCommand extends BaseCommand {
    @isUserInTheVoiceChannel()
    @isMusicPlaying()
    @isSameVoiceChannel()
    public execute(message: IMessage, args: string[]): any {
        let volume = Number(args[0]);

        if (isNaN(volume)) return message.channel.send(createEmbed("info", `📶 Al momento il volume è impostato a: ${message.guild!.queue!.volume.toString()}`));

        if (volume < 0) volume = 0;
        if (volume === 0) return message.channel.send(createEmbed("warn", "❗ Metti in pausa invece di mettere il volume a \`0\`"));
        if (Number(args[0]) > this.client.config.maxVolume) {
            return message.channel.send(
                createEmbed("warn", `❗ Non posso mettere il volume più alto di così, una visita da Amplifon? \`${this.client.config.maxVolume}\``)
            );
        }

        message.guild!.queue!.volume = Number(args[0]);
        message.guild!.queue!.connection?.dispatcher.setVolume(Number(args[0]) / this.client.config.maxVolume);
        message.channel.send(createEmbed("info", `📶 Volume impostato a ${args[0]}`)).catch(console.error);
    }
}
