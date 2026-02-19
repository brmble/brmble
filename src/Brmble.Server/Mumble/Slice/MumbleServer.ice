// Copyright The Mumble Developers. All rights reserved.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file at the root of the
// Mumble source tree or at <https://www.mumble.info/LICENSE>.

/**
 *
 * Information and control of the Mumble server. Each server has
 * one {@link Meta} interface that controls global information, and
 * each virtual server has a {@link Server} interface.
 *
 **/

#include <Ice/SliceChecksumDict.ice>

module MumbleServer
{

	/** A network address in IPv6 format.
	 **/
	["python:seq:tuple"] sequence<byte> NetAddress;

	/** A connected user.
	 **/
	struct User {
		/** Session ID. This identifies the connection to the server. */
		int session;
		/** User ID. -1 if the user is anonymous. */
		int userid;
		/** Is user muted by the server? */
		bool mute;
		/** Is user deafened by the server? If true, this implies mute. */
		bool deaf;
		/** Is the user suppressed by the server? This means the user is not muted, but does not have speech privileges in the current channel. */
		bool suppress;
		/** Is the user a priority speaker? */
		bool prioritySpeaker;
		/** Is the user self-muted? */
		bool selfMute;
		/** Is the user self-deafened? If true, this implies mute. */
		bool selfDeaf;
		/** Is the User recording? (This flag is read-only and cannot be changed using setState().) **/
		bool recording;
		/** Channel ID the user is in. Matches {@link Channel.id}. */
		int channel;
		/** The name of the user. */
		string name;
		/** Seconds user has been online. */
		int onlinesecs;
		/** Average transmission rate in bytes per second over the last few seconds. */
		int bytespersec;
		/** Legacy client version. */
		int version;
		/** New client version. (See https://github.com/mumble-voip/mumble/issues/5827) */
		long version2;
		/** Client release. For official releases, this equals the version. For snapshots and git compiles, this will be something else. */
		string release;
		/** Client OS. */
		string os;
		/** Client OS Version. */
		string osversion;
		/** Plugin Identity. This will be the user's unique ID inside the current game. */
		string identity;
		/**
		   Base64-encoded Plugin context. This is a binary blob identifying the game and team the user is on.

		   The used Base64 alphabet is the one specified in RFC 2045.

		   Before Mumble 1.3.0, this string was not Base64-encoded. This could cause problems for some Ice
		   implementations, such as the .NET implementation.

		   If you need the exact string that is used by Mumble, you can get it by Base64-decoding this string.

		   If you simply need to detect whether two users are in the same game world, string comparisons will
		   continue to work as before.
		 */
		string context;
		/** User comment. Shown as tooltip for this user. */
		string comment;
		/** Client address. */
		NetAddress address;
		/** TCP only. True until UDP connectivity is established. */
		bool tcponly;
		/** Idle time. This is how many seconds it is since the user last spoke. Other activity is not counted. */
		int idlesecs;
		/** UDP Ping Average. This is the average ping for the user via UDP over the duration of the connection. */
		float udpPing;
		/** TCP Ping Average. This is the average ping for the user via TCP over the duration of the connection. */
		float tcpPing;
	};

	sequence<int> IntList;

	/** A text message between users.
	 **/
	struct TextMessage {
		/** Sessions (connected users) who were sent this message. */
		IntList sessions;
		/** Channels who were sent this message. */
		IntList channels;
		/** Trees of channels who were sent this message. */
		IntList trees;
		/** The contents of the message. */
		string text;
	};

	/** A channel.
	 **/
	struct Channel {
		/** Channel ID. This is unique per channel, and the root channel is always id 0. */
		int id;
		/** Name of the channel. There can not be two channels with the same parent that has the same name. */
		string name;
		/** ID of parent channel, or -1 if this is the root channel. */
		int parent;
		/** List of id of linked channels. */
		IntList links;
		/** Description of channel. Shown as tooltip for this channel. */
		string description;
		/** Channel is temporary, and will be removed when the last user leaves it. Read-only. */
		bool temporary;
		/** Position of the channel which is used in Client for sorting. */
		int position;
	};

	/** A group. Groups are defined per channel, and can inherit members from parent channels.
	 **/
	struct Group {
		/** Group name */
		string name;
		/** Is this group inherited from a parent channel? Read-only. */
		bool inherited;
		/** Does this group inherit members from parent channels? */
		bool inherit;
		/** Can subchannels inherit members from this group? */
		bool inheritable;
		/** List of users to add to the group. */
		IntList add;
		/** List of inherited users to remove from the group. */
		IntList remove;
		/** Current members of the group, including inherited members. Read-only. */
		IntList members;
	};

	/** Write access to channel control. Implies all other permissions (except Speak). */
	const int PermissionWrite = 0x01;
	/** Traverse channel. Without this, a client cannot reach subchannels, no matter which privileges he has there. */
	const int PermissionTraverse = 0x02;
	/** Enter channel. */
	const int PermissionEnter = 0x04;
	/** Speak in channel. */
	const int PermissionSpeak = 0x08;
	/** Whisper to channel. This is different from Speak, so you can set up different permissions. */
	const int PermissionWhisper = 0x100;
	/** Mute and deafen other users in this channel. */
	const int PermissionMuteDeafen = 0x10;
	/** Move users from channel. You need this permission in both the source and destination channel to move another user. */
	const int PermissionMove = 0x20;
	/** Make new channel as a subchannel of this channel. */
	const int PermissionMakeChannel = 0x40;
	/** Make new temporary channel as a subchannel of this channel. */
	const int PermissionMakeTempChannel = 0x400;
	/** Link this channel. You need this permission in both the source and destination channel to link channels, or in either channel to unlink them. */
	const int PermissionLinkChannel = 0x80;
	/** Send text message to channel. */
	const int PermissionTextMessage = 0x200;
	/** Kick user from server. Only valid on root channel. */
	const int PermissionKick = 0x10000;
	/** Ban user from server. Only valid on root channel. */
	const int PermissionBan = 0x20000;
	/** Register and unregister users. Only valid on root channel. */
	const int PermissionRegister = 0x40000;
	/** Register and unregister users. Only valid on root channel. */
	const int PermissionRegisterSelf = 0x80000;
	/** Reset the comment or avatar of a user. Only valid on root channel. */
	const int ResetUserContent = 0x100000;


	/** Access Control List for a channel. ACLs are defined per channel, and can be inherited from parent channels.
	 **/
	struct ACL {
		/** Does the ACL apply to this channel? */
		bool applyHere;
		/** Does the ACL apply to subchannels? */
		bool applySubs;
		/** Is this ACL inherited from a parent channel? Read-only. */
		bool inherited;
		/** ID of user this ACL applies to. -1 if using a group name. */
		int userid;
		/** Group this ACL applies to. Blank if using userid. */
		string group;
		/** Binary mask of privileges to allow. */
		int allow;
		/** Binary mask of privileges to deny. */
		int deny;
	};

	/** A single ip mask for a ban.
	 **/
	struct Ban {
		/** Address to ban. */
		NetAddress address;
		/** Number of bits in ban to apply. */
		int bits;
		/** Username associated with ban. */
		string name;
		/** Hash of banned user. */
		string hash;
		/** Reason for ban. */
		string reason;
		/** Date ban was applied in unix time format. */
		int start;
		/** Duration of ban. */
		int duration;
	};

	/** A entry in the log.
	 **/
	struct LogEntry {
		/** Timestamp in UNIX time_t */
		int timestamp;
		/** The log message. */
		string txt;
	};

	class Tree;
	sequence<Tree> TreeList;

	enum ChannelInfo { ChannelDescription, ChannelPosition };
	enum UserInfo { UserName, UserEmail, UserComment, UserHash, UserPassword, UserLastActive, UserKDFIterations };

	dictionary<int, User> UserMap;
	dictionary<int, Channel> ChannelMap;
	sequence<Channel> ChannelList;
	sequence<User> UserList;
	sequence<Group> GroupList;
	sequence<ACL> ACLList;
	sequence<LogEntry> LogList;
	sequence<Ban> BanList;
	sequence<int> IdList;
	sequence<string> NameList;
	dictionary<int, string> NameMap;
	dictionary<string, int> IdMap;
	sequence<byte> Texture;
	dictionary<string, string> ConfigMap;
	sequence<string> GroupNameList;
	sequence<byte> CertificateDer;
	sequence<CertificateDer> CertificateList;

	/** User information map.
	 * Older versions of ice-php can't handle enums as keys. If you are using one of these, replace 'UserInfo' with 'byte'.
	 */

	dictionary<UserInfo, string> UserInfoMap;

	/** User and subchannel state. Read-only.
	 **/
	class Tree {
		/** Channel definition of current channel. */
		Channel c;
		/** List of subchannels. */
		TreeList children;
		/** Users in this channel. */
		UserList users;
	};

	/** Different states of the underlying database */
	enum DBState { Normal, ReadOnly };

	exception ServerException {};
	exception InternalErrorException extends ServerException {};
	exception InvalidSessionException extends ServerException {};
	exception InvalidChannelException extends ServerException {};
	exception InvalidServerException extends ServerException {};
	exception ServerBootedException extends ServerException {};
	exception ServerFailureException extends ServerException {};
	exception InvalidUserException extends ServerException {};
	exception InvalidTextureException extends ServerException {};
	exception InvalidCallbackException extends ServerException {};
	exception InvalidSecretException extends ServerException {};
	exception NestingLimitException extends ServerException {};
	exception WriteOnlyException extends ServerException {};
	exception InvalidInputDataException extends ServerException {};
	exception InvalidListenerException extends ServerException {};
	exception ReadOnlyModeException extends ServerException {};

	/** Callback interface for servers. You can supply an implementation of this to receive notification
	 *  messages from the server.
	 **/
	interface ServerCallback {
		idempotent void userConnected(User state);
		idempotent void userDisconnected(User state);
		idempotent void userStateChanged(User state);
		idempotent void userTextMessage(User state, TextMessage message);
		idempotent void channelCreated(Channel state);
		idempotent void channelRemoved(Channel state);
		idempotent void channelStateChanged(Channel state);
	};

	/** Context for actions in the Server menu. */
	const int ContextServer = 0x01;
	const int ContextChannel = 0x02;
	const int ContextUser = 0x04;

	interface ServerContextCallback {
		idempotent void contextAction(string action, User usr, int session, int channelid);
	};

	interface ServerAuthenticator {
		idempotent int authenticate(string name, string pw, CertificateList certificates, string certhash, bool certstrong, out string newname, out GroupNameList groups);
		idempotent bool getInfo(int id, out UserInfoMap info);
		idempotent int nameToId(string name);
		idempotent string idToName(int id);
		idempotent Texture idToTexture(int id);
	};

	interface ServerUpdatingAuthenticator extends ServerAuthenticator {
		int registerUser(UserInfoMap info);
		int unregisterUser(int id);
		idempotent NameMap getRegisteredUsers(string filter);
		idempotent int setInfo(int id, UserInfoMap info);
		idempotent int setTexture(int id, Texture tex);
	};

	["amd"] interface Server {
		idempotent bool isRunning() throws InvalidSecretException;
		void start() throws ServerBootedException, ServerFailureException, InvalidSecretException, ReadOnlyModeException;
		void stop() throws ServerBootedException, InvalidSecretException, ReadOnlyModeException;
		void delete() throws ServerBootedException, InvalidSecretException, ReadOnlyModeException;
		idempotent int id() throws InvalidSecretException;
		void addCallback(ServerCallback *cb) throws ServerBootedException, InvalidCallbackException, InvalidSecretException;
		void removeCallback(ServerCallback *cb) throws ServerBootedException, InvalidCallbackException, InvalidSecretException;
		void setAuthenticator(ServerAuthenticator *auth) throws ServerBootedException, InvalidCallbackException, InvalidSecretException, ReadOnlyModeException;
		idempotent string getConf(string key) throws InvalidSecretException, WriteOnlyException, ReadOnlyModeException;
		idempotent ConfigMap getAllConf() throws InvalidSecretException, ReadOnlyModeException;
		idempotent void setConf(string key, string value) throws InvalidSecretException, ReadOnlyModeException;
		idempotent void setSuperuserPassword(string pw) throws InvalidSecretException, ReadOnlyModeException;
		idempotent LogList getLog(int first, int last) throws InvalidSecretException, ReadOnlyModeException;
		idempotent int getLogLen() throws InvalidSecretException, ReadOnlyModeException;
		idempotent UserMap getUsers() throws ServerBootedException, InvalidSecretException;
		idempotent ChannelMap getChannels() throws ServerBootedException, InvalidSecretException;
		idempotent CertificateList getCertificateList(int session) throws ServerBootedException, InvalidSessionException, InvalidSecretException;
		idempotent Tree getTree() throws ServerBootedException, InvalidSecretException;
		idempotent BanList getBans() throws ServerBootedException, InvalidSecretException;
		idempotent void setBans(BanList bans) throws ServerBootedException, InvalidSecretException, ReadOnlyModeException;
		void kickUser(int session, string reason) throws ServerBootedException, InvalidSessionException, InvalidSecretException;
		idempotent User getState(int session) throws ServerBootedException, InvalidSessionException, InvalidSecretException;
		idempotent void setState(User state) throws ServerBootedException, InvalidSessionException, InvalidChannelException, InvalidSecretException;
		void sendMessage(int session, string text) throws ServerBootedException, InvalidSessionException, InvalidSecretException;
		bool hasPermission(int session, int channelid, int perm) throws ServerBootedException, InvalidSessionException, InvalidChannelException, InvalidSecretException;
		idempotent int effectivePermissions(int session, int channelid) throws ServerBootedException, InvalidSessionException, InvalidChannelException, InvalidSecretException;
		void addContextCallback(int session, string action, string text, ServerContextCallback *cb, int ctx) throws ServerBootedException, InvalidCallbackException, InvalidSecretException;
		void removeContextCallback(ServerContextCallback *cb) throws ServerBootedException, InvalidCallbackException, InvalidSecretException;
		idempotent Channel getChannelState(int channelid) throws ServerBootedException, InvalidChannelException, InvalidSecretException;
		idempotent void setChannelState(Channel state) throws ServerBootedException, InvalidChannelException, InvalidSecretException, NestingLimitException, ReadOnlyModeException;
		void removeChannel(int channelid) throws ServerBootedException, InvalidChannelException, InvalidSecretException, ReadOnlyModeException;
		int addChannel(string name, int parent) throws ServerBootedException, InvalidChannelException, InvalidSecretException, NestingLimitException, ReadOnlyModeException;
		void sendMessageChannel(int channelid, bool tree, string text) throws ServerBootedException, InvalidChannelException, InvalidSecretException;
		idempotent void getACL(int channelid, out ACLList acls, out GroupList groups, out bool inherit) throws ServerBootedException, InvalidChannelException, InvalidSecretException;
		idempotent void setACL(int channelid, ACLList acls, GroupList groups, bool inherit) throws ServerBootedException, InvalidChannelException, InvalidSecretException, ReadOnlyModeException;
		idempotent void addUserToGroup(int channelid, int session, string group) throws ServerBootedException, InvalidChannelException, InvalidSessionException, InvalidSecretException;
		idempotent void removeUserFromGroup(int channelid, int session, string group) throws ServerBootedException, InvalidChannelException, InvalidSessionException, InvalidSecretException;
		idempotent void redirectWhisperGroup(int session, string source, string target) throws ServerBootedException, InvalidSessionException, InvalidSecretException;
		idempotent NameMap getUserNames(IdList ids) throws ServerBootedException, InvalidSecretException;
		idempotent IdMap getUserIds(NameList names) throws ServerBootedException, InvalidSecretException;
		int registerUser(UserInfoMap info) throws ServerBootedException, InvalidUserException, InvalidSecretException, ReadOnlyModeException;
		void unregisterUser(int userid) throws ServerBootedException, InvalidUserException, InvalidSecretException, ReadOnlyModeException;
		idempotent void updateRegistration(int userid, UserInfoMap info) throws ServerBootedException, InvalidUserException, InvalidSecretException, ReadOnlyModeException;
		idempotent UserInfoMap getRegistration(int userid) throws ServerBootedException, InvalidUserException, InvalidSecretException, ReadOnlyModeException;
		idempotent NameMap getRegisteredUsers(string filter) throws ServerBootedException, InvalidSecretException, ReadOnlyModeException;
		idempotent int verifyPassword(string name, string pw) throws ServerBootedException, InvalidSecretException, ReadOnlyModeException;
		idempotent Texture getTexture(int userid) throws ServerBootedException, InvalidUserException, InvalidSecretException;
		idempotent void setTexture(int userid, Texture tex) throws ServerBootedException, InvalidUserException, InvalidTextureException, InvalidSecretException, ReadOnlyModeException;
		idempotent int getUptime() throws ServerBootedException, InvalidSecretException;
		idempotent void updateCertificate(string certificate, string privateKey, string passphrase) throws ServerBootedException, InvalidSecretException, InvalidInputDataException, ReadOnlyModeException;
		idempotent void startListening(int userid, int channelid) throws ServerBootedException, InvalidUserException, ReadOnlyModeException;
		idempotent void stopListening(int userid, int channelid) throws ServerBootedException, InvalidUserException, ReadOnlyModeException;
		idempotent bool isListening(int userid, int channelid) throws ServerBootedException, InvalidUserException, InvalidSecretException;
		idempotent IntList getListeningChannels(int userid) throws ServerBootedException, InvalidSecretException, InvalidUserException;
		idempotent IntList getListeningUsers(int channelid) throws ServerBootedException, InvalidSecretException, InvalidChannelException;
		idempotent float getListenerVolumeAdjustment(int channelid, int userid) throws ServerBootedException, InvalidUserException, InvalidChannelException;
		idempotent void setListenerVolumeAdjustment(int channelid, int userid, float volumeAdjustment) throws ServerBootedException, InvalidSecretException, InvalidChannelException, InvalidUserException, ReadOnlyModeException;
		idempotent void sendWelcomeMessage(IdList receiverUserIDs) throws ServerBootedException, InvalidSecretException, InvalidUserException;
	};

	interface MetaCallback {
		void started(Server *srv);
		void stopped(Server *srv);
	};

	sequence<Server *> ServerList;

	["amd"] interface Meta {
		idempotent Server *getServer(int id) throws InvalidSecretException;
		Server *newServer() throws InvalidSecretException;
		idempotent ServerList getBootedServers() throws InvalidSecretException;
		idempotent ServerList getAllServers() throws InvalidSecretException;
		idempotent ConfigMap getDefaultConf() throws InvalidSecretException;
		idempotent void getVersion(out int major, out int minor, out int patch, out string text);
		void addCallback(MetaCallback *cb) throws InvalidCallbackException, InvalidSecretException;
		void removeCallback(MetaCallback *cb) throws InvalidCallbackException, InvalidSecretException;
		idempotent int getUptime();
		idempotent string getSlice();
		idempotent Ice::SliceChecksumDict getSliceChecksums();
		idempotent DBState getAssumedDatabaseState() throws InvalidSecretException;
		idempotent void setAssumedDatabaseState(DBState state) throws InvalidSecretException, ReadOnlyModeException;
	};
};
