# search.py
# ---------
# Licensing Information:  You are free to use or extend these projects for
# educational purposes provided that (1) you do not distribute or publish
# solutions, (2) you retain this notice, and (3) you provide clear
# attribution to UC Berkeley, including a link to http://ai.berkeley.edu.
#
# Attribution Information: The Pacman AI projects were developed at UC Berkeley.
# The core projects and autograders were primarily created by John DeNero
# (denero@cs.berkeley.edu) and Dan Klein (klein@cs.berkeley.edu).
# Student side autograding was added by Brad Miller, Nick Hay, and
# Pieter Abbeel (pabbeel@cs.berkeley.edu).


"""
In search.py, you will implement generic search algorithms which are called by
Pacman agents (in searchAgents.py).
"""

import util


class SearchProblem:
    """
    This class outlines the structure of a search problem, but doesn't implement
    any of the methods (in object-oriented terminology: an abstract class).

    You do not need to change anything in this class, ever.
    """

    def getStartState(self):
        """
        Returns the start state for the search problem.
        """
        util.raiseNotDefined()

    def isGoalState(self, state):
        """
          state: Search state

        Returns True if and only if the state is a valid goal state.
        """
        util.raiseNotDefined()

    def getSuccessors(self, state):
        """
          state: Search state

        For a given state, this should return a list of triples, (successor,
        action, stepCost), where 'successor' is a successor to the current
        state, 'action' is the action required to get there, and 'stepCost' is
        the incremental cost of expanding to that successor.
        """
        util.raiseNotDefined()

    def getCostOfActions(self, actions):
        """
         actions: A list of actions to take

        This method returns the total cost of a particular sequence of actions.
        The sequence must be composed of legal moves.
        """
        util.raiseNotDefined()


def tinyMazeSearch(problem):
    """
    Returns a sequence of moves that solves tinyMaze.  For any other maze, the
    sequence of moves will be incorrect, so only use this for tinyMaze.
    """
    from game import Directions
    s = Directions.SOUTH
    w = Directions.WEST
    return [s, s, w, s, w, w, s, w]


class Node:
    """
    We recommend that you implement a Node class for bookkeeping.
    Note that you should override the  __hash__ and __eq__ internal methods.
    """

    def __init__(self,state,action,parent,cost=1):
        self.state = state
        self.cost = cost
        self.action = action
        self.parent = parent

    def __hash__(self):
        return hash(self.state)

    def __eq__(self, other):
        return isinstance(other, Node) and self.state == other.state #checks of objects are comparable, then checks if same Node

    def trace(self):
        """
        Return the list of actions by tracing through
        the chain of parent member variables.

        Recommended but not required to have.
        """
        path = [] #initializes list to store directions into
        node = self #current node is the one passed into trace
        while node.parent: #while the current node has a parent node
            path.append(node.action) #add current node's action, which is in the form of a direction
            node = node.parent #make current node into its parent node
        # from IPython import embed
        # embed(local_ns=locals())
        # print('FNWIBGRBGRW;GBRWBG')
        path.reverse()
        return path


def depthFirstTreeSearch(problem):
    """
    Search the deepest nodes in the search tree first.

    Your search algorithm needs to return a list of actions that reaches the
    goal.

    To get started, you might want to try some of these simple commands to
    understand the search problem that is being passed in:

    print "Start:", problem.getStartState()
    print "Is the start a goal?", problem.isGoalState(problem.getStartState())
    print "Start's successors:", problem.getSuccessors(problem.getStartState())

    problem.getStartState(): returns a pair (tuple of size 2) that represents
    the coordinate of where the pacman starts

    problem.isGoalState((x, y)): returns a boolean True/False based on whether
    the coordinate (x, y) is a goal state.

    problem.getSuccessors((x, y)): given a position (x, y), returns a list of
    triples (list of tuples, with each tuple being size 3) of the successor
    positions of pacman.
    The tuple consists of position, action required to get to it, and the step
    cost i.e. ((35,2), 'North', 1).

    Remember to use the data structures in util.py: Stack, Queue, or
    PriorityQueue

    Remember to process the list of successors as a batch for the current state.

    For the search functions, you are required to return a list of actions
    (that is, a list of strings such as ['North', 'North', 'West'])
    """
    fringe = util.Stack() #initialize fringe with instance of Queue
    start = Node(state=problem.getStartState(), action=None, parent=None) #instantiate start Node
    fringe.push(start) #push start Node onto fringe

    while not fringe.isEmpty(): #while fringe still has Nodes in it
        current = fringe.pop() #obtain the first Node on the fringe
        if problem.isGoalState(current.state): #if the current Node is the goal state
            return current.trace() #return the path taken as a list of directions
        else: #if not the goal state
            successors = util.Stack() #intitialize stack for successors
            for state, action, ignore in problem.getSuccessors(current.state): #loops through successor Nodes
                successor = Node(state=state, action=action, parent=current) #initializes current successor Node
                successors.push(successor) #pushes all successor nodes into successors stack
            while not successors.isEmpty(): #while successors stack is not empty
                current_s = successors.pop() #initialize current_s to current first successor on stack
                fringe.push(current_s) #push current successor into fringe


def breadthFirstTreeSearch(problem):
    """Search the shallowest nodes in the search tree first."""
    # from IPython import embed
    # embed(local_ns=locals())

    fringe = util.Queue() #initialize fringe with instance of Queue
    start = Node(state=problem.getStartState(), action=None, parent=None) #instantiate start Node
    fringe.push(start) #push start Node onto fringe

    while not fringe.isEmpty():
        current = fringe.pop() #obtain the first Node on the fringe
        if problem.isGoalState(current.state): #if the current Node is the goal state
            return current.trace() #return the path taken as a list of directions
        else:
            successors = util.Queue() #instantiates a Stack for the successor Nodes
            for state, action, ignore in problem.getSuccessors(current.state): #loops through successor Nodes
                successor = Node(state=state, action=action, parent=current) #initializes current successor Node
                successors.push(successor)

            while not successors.isEmpty(): #loop through list of successors
                fringe.push(successors.pop()) #push successors onto fringe

    util.raiseNotDefined()


def depthFirstSearch(problem):
    """
    Search the deepest nodes in the search tree first.
    Use a graph search here.
    """
    fringe = util.Stack() #initialize fringe with instance of Queue
    start = Node(state=problem.getStartState(), action=None, parent=None) #instantiate start Node
    fringe.push(start) #push start Node onto fringe
    closed_list = []

    while not fringe.isEmpty(): #while fringe still has Nodes in it
        current = fringe.pop() #obtain the first Node on the fringe
        if problem.isGoalState(current.state): #if the current Node is the goal state
            return current.trace() #return the path taken as a list of directions
        else: #if not the goal state
            if current not in closed_list: #if current node has not been expanded yet
                closed_list.append(current) #add current node to closed_list
                successors = util.Stack() #intitialize stack for successors
                for state, action, ignore in problem.getSuccessors(current.state): #loops through successor Nodes
                    successor = Node(state=state, action=action, parent=current) #initializes current successor Node
                    successors.push(successor) #pushes all successor nodes into successors stack
                while not successors.isEmpty(): #while successors stack is not empty
                    current_s = successors.pop() #initialize current_s to current first successor on stack
                    if current_s not in fringe.list: #if current successor is not in fringe
                        fringe.push(current_s) #push current successor into fringe


def breadthFirstSearch(problem):
    """
    Search the shallowest nodes in the search tree first.
    Use a graph search here.
    """

    # from IPython import embed
    # embed(local_ns=locals())

    fringe = util.Queue() #initialize fringe with instance of Queue
    start = Node(state=problem.getStartState(), action=None, parent=None) #instantiate start Node
    fringe.push(start) #push start Node onto fringe
    fringe_list = []

    while not fringe.isEmpty():
        current = fringe.pop() #obtain the first Node on the fringe
        if problem.isGoalState(current.state): #if the current Node is the goal state
            return current.trace() #return the path taken as a list of directions
        else:
            successors = problem.getSuccessors(current.state)
            for state, action, ignore in successors: #loops through successor Nodes
                successor = Node(state=state, action=action, parent=current) #initializes current successor Node
                if successor not in fringe_list:
                    fringe.push(successor)
                    fringe_list.append(successor)


def iterativeDeepeningSearch(problem):
    """
    Search the deepest nodes in the search tree first.
    Use your own max_depth variable (you will be tuning this).
    Write this function iteratively, not recursively.
    """
    '''YOUR CODE HERE'''
    util.raiseNotDefined()


def uniformCostSearch(problem):
    """Search the node of least total cost first."""
    '''YOUR CODE HERE'''
    util.raiseNotDefined()


def nullHeuristic(state, problem=None):
    """
    A heuristic function estimates the cost from the current state to the
    nearest goal in the provided SearchProblem.  This heuristic is trivial.
    """
    return 0


def aStarSearch(problem, heuristic=nullHeuristic):
    """Search the node that has the lowest combined cost and heuristic first."""
    '''YOUR CODE HERE'''
    util.raiseNotDefined()


# Abbreviations
dfts = depthFirstTreeSearch
bfts = breadthFirstTreeSearch
bfs = breadthFirstSearch
dfs = depthFirstSearch
ids = iterativeDeepeningSearch
astar = aStarSearch
ucs = uniformCostSearch
