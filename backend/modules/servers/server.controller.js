const serverService = require("./server.service");

const createServer = async (req, res, next) => {
  try {
    const { name, description, icon } = req.body;
    const { server, defaultChannel } = await serverService.createServer(req.user._id, {
      name,
      description,
      icon,
    });
    return res.status(201).json({ success: true, server, defaultChannel });
  } catch (error) {
    next(error);
  }
};

const listMyServers = async (req, res, next) => {
  try {
    const servers = await serverService.listMyServers(req.user._id);
    return res.status(200).json({ success: true, servers });
  } catch (error) {
    next(error);
  }
};

const getServer = async (req, res, next) => {
  try {
    const server = await serverService.getServerById(req.params.serverId);
    return res.status(200).json({ success: true, server, role: req.membership.role });
  } catch (error) {
    next(error);
  }
};

const joinServer = async (req, res, next) => {
  try {
    const { membership, alreadyMember } = await serverService.joinServer(
      req.params.serverId,
      req.user._id
    );
    return res
      .status(alreadyMember ? 200 : 201)
      .json({ success: true, alreadyMember, role: membership.role });
  } catch (error) {
    next(error);
  }
};

const leaveServer = async (req, res, next) => {
  try {
    await serverService.leaveServer(req.params.serverId, req.user._id);
    return res.status(200).json({ success: true, message: "Left server" });
  } catch (error) {
    next(error);
  }
};

const listMembers = async (req, res, next) => {
  try {
    const members = await serverService.listMembers(req.params.serverId);
    return res.status(200).json({ success: true, members });
  } catch (error) {
    next(error);
  }
};

module.exports = { createServer, listMyServers, getServer, joinServer, leaveServer, listMembers };
