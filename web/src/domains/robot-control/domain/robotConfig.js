export const ROBOT_CONFIG = {
  indy7: { chain: ['joint0', 'joint1', 'joint2', 'joint3', 'joint4', 'joint5'], tcp: 'tcp' },
  indy12: { chain: ['joint0', 'joint1', 'joint2', 'joint3', 'joint4', 'joint5'], tcp: 'tcp' },
  ur5e: {
    chain: [
      'shoulder_pan_joint',
      'shoulder_lift_joint',
      'elbow_joint',
      'wrist_1_joint',
      'wrist_2_joint',
      'wrist_3_joint',
    ],
    tcp: 'tool0',
  },
  ur10e: {
    chain: [
      'shoulder_pan_joint',
      'shoulder_lift_joint',
      'elbow_joint',
      'wrist_1_joint',
      'wrist_2_joint',
      'wrist_3_joint',
    ],
    tcp: 'tool0',
  },
  panda: {
    chain: [
      'panda_joint1',
      'panda_joint2',
      'panda_joint3',
      'panda_joint4',
      'panda_joint5',
      'panda_joint6',
      'panda_joint7',
    ],
    tcp: 'panda_link8',
  },
  fanuc: { chain: ['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6'], tcp: 'tool0' },
};
